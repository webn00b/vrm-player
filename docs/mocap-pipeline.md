# Мокап и ретаргет: техническая документация

Этот документ нужен для разработки и отладки.

Если нужно просто запустить проект и понять, какие кнопки нажимать, сначала откройте [README](../README.md) или [user-guide.md](./user-guide.md).

Если задача — не лезть в код, а быстро понять, почему поза выглядит неправильно, сначала откройте [troubleshooting.md](./troubleshooting.md).

Если нужно быстро сориентироваться по модулям и зависимостям, откройте [architecture.md](./architecture.md).

## Что описывает этот документ

- из каких частей состоит мокап-пайплайн;
- в каком порядке слои пишут итоговую позу;
- где принимаются решения по торсу, рукам, кистям и ногам;
- какие debug-метрики смотреть, если поза выглядит неправильно.

## Короткая схема

```text
video / camera
  -> PoseDetector
  -> MocapController
  -> MocapCalibration
  -> DirectPoseApplier
  -> final hand overlay
  -> validator
  -> debug capture / debug skeleton
  -> BVH recorder / current-pose export
```

## Основные части

### `src/mocap/poseDetector.ts`

Источник данных из MediaPipe.

На выходе даёт:

- `landmarks` и `worldLandmarks` тела;
- `hands` с landmark-ами кистей;
- `faceLandmarks`;
- visibility для оценки качества трекинга.

Сам `PoseDetector` не крутит кости. Он только поставляет кадры.

### `src/mocap/mocapController.ts`

Оркестратор мокапа.

Отвечает за:

- состояние `off / live / recording / from-file`;
- хранение `latestFrame`;
- калибровку;
- вызов `DirectPoseApplier`;
- запись BVH;
- экспорт текущей позы как `1-frame BVH`.

Именно здесь живут пользовательские действия вроде:

- `Start`
- `Rec`
- `Load`
- `grabFrame()`
- `flushGrabbed()`
- `exportCurrentPoseBvh()`

### `src/mocap/mocapCalibration.ts`

Считает пропорции перформера и коэффициенты, которыми потом масштабируются цели IK.

Главные выходы:

- `bodyScale`
- `armScale(left/right)`
- `legScale()`
- отношение ширины плеч
- длины сегментов аватара

Это важная часть пайплайна: очень многие баги рук и ног выглядят как "плохой IK", но на деле начинаются здесь, когда scale оценён слишком маленьким или слишком большим.

### `src/mocap/directPoseApplier.ts`

Главный solver.

Именно он превращает landmarks в:

- поворот таза;
- поворот spine/chest;
- цели для IK рук и ног;
- overlay кистей и пальцев;
- debug-метрики, которые потом видны в `Skeleton Info`.

### `src/debugPanel.ts`

Показывает все runtime-переключатели и собирает текстовый debug-дамп.

Если вы смотрите на `Skeleton Info`, почти все строки в этом документе соответствуют данным, которые выводятся отсюда.

## Порядок слоёв в кадре

Финальный порядок важен, потому что почти все слои пишут в одни и те же кости.

Рантайм-цикл находится в `src/main.ts`.

Порядок такой:

1. `AnimationController.update(delta)` проигрывает BVH через `AnimationMixer`.
2. Если BVH нет или он замьючен, применяются idle / priority позы.
3. `mocap.applyLatestFrame()` пишет live-мокап поверх анимации.
4. `bonePanel.apply()` добавляет ручные оффсеты костей.
5. `mocap.applyTrackedHandsOverlay()` ещё раз применяет tracked hands как верхний слой.
6. `validator.clampAll(...)` ограничивает итоговую authored-позу.
7. `dbgRecorder.capture(...)` снимает debug-снимок.
8. `mocapDebugViz.update(...)` обновляет performer/debug skeleton.
9. `micro.update(vrm)` добавляет мелкие procedural-эффекты.
10. `vrm.update(delta)` считает внутренние VRM-системы.
11. `skelViz.update()` обновляет финальный skeleton overlay.

Практическое правило:

- если ошибка уже есть в debug skeleton, проблема до ретаргета в аватар;
- если debug skeleton выглядит нормально, а аватар нет, проблема уже в solver-е, rest-pose correction или order of layers.

## Как solver собирает тело

### 1. Таз (`hips`)

`DirectPoseApplier` строит базис таза по landmarks бёдер и направления туловища, затем переводит целевой world rotation в локаль родителя `hips`.

Дополнительно:

- позиция таза может переноситься по миру, если включён `Hip position`;
- для таза боковой roll намеренно подавляется, чтобы сильный side bend не жил и в тазе, и в spine одновременно.

Это сделано специально: боковой наклон должен в основном читаться в верхней части корпуса, иначе на асимметричных позах torso может "ломаться" в неправильную сторону.

### 2. Позвоночник (`spine`, `chest`, `upperChest`)

После ориентации таза solver считает остаточный bend корпуса:

- `forwardLean` — наклон вперёд / назад;
- `lateralLean` — наклон вбок;
- `twist` — разницу между линией плеч и линией бёдер.

Эти компоненты применяются уже в локали `hips`.

Что важно:

- поворот строится не только по линии плеч;
- для forward bend используется реальное смещение `midHip -> midShoulder`, а не только плоская проекция;
- для lateral bend сейчас используется adaptive gain, чтобы сильные боковые наклоны не терялись.

Если torso "стоит как столб", смотреть нужно именно сюда.

### 3. Руки

Для рук используется two-bone IK:

- root: плечо аватара;
- mid joint: локоть;
- end effector: кисть.

Solver для рук опирается на несколько отдельных идей.

#### Масштаб руки

Базовая цель строится из performer wrist offset, умноженного на:

- `armScale` для длины руки;
- `shoulderScale` для сжатия по ширине корпуса;
- `Arm Z atten` для глубины.

Если `armScale` получается подозрительно большим, применяется дополнительный cap по текущей сумме сегментов `shoulder->elbow + elbow->wrist`, чтобы IK не вытягивал локоть в прямую линию.

#### Midpoint / folded-hand логика

Когда кисть идёт к центру корпуса, solver постепенно смешивает цель:

- от same-side shoulder anchor;
- к midpoint между плечами.

Эта часть отвечает за folded-hands, crossed-arms и похожие позы.

#### `handsTogether`

Если обе кисти находятся близко друг к другу, solver включает специальную ветку, которая:

- тянет обе цели к общему wrist midpoint;
- оставляет небольшой симметричный gap между запястьями;
- уменьшает эффект "руки разъехались в стороны".

#### `prayer`

Если руки согнуты и сведены вместе перед грудью, включается prayer-логика.

Она делает три вещи:

- переякоривает wrist target ближе к `upperChest / chest / spine`;
- может поднимать anchor ближе к `neck` в очень близких позах;
- режет избыточный `front-pose` вклад, чтобы руки не тянулись вперёд как reach-поза.

#### `face-near`

Если fingertips приближаются к лицу, включается отдельная ветка `face-near`.

Она нужна для поз вроде:

- руки у рта;
- пальцы у губ;
- folded hands у подбородка или шеи.

В этой ветке wrist target поднимается выше обычного prayer-anchor и сильнее подавляется лишний forward reach.

### 4. Ноги

Для ног тоже используется two-bone IK, но только когда lower-body действительно доступен.

Если кадр верхнетелый и ноги не видны:

- leg IK не должен строиться по шуму;
- ankle targets выключаются;
- ноги возвращаются к нейтральной стойке вместо попытки угадывать движение.

Именно поэтому в `Skeleton Info` важно смотреть на:

- `Legs ready`
- `Leg length`
- `Ankle targets`

Если `Legs ready: —` или `Leg length: 0`, а ноги всё равно "живут своей жизнью", значит solver ошибочно использует недостоверные landmarks.

### 5. Кисти и пальцы

Кисти и пальцы сейчас рассматриваются как отдельный верхний слой.

Когда включён `Wrist + fingers priority`:

- ориентация ладони берётся из hand landmarks;
- пальцы приходят из hand solver-а;
- после основного мокапа кисти и пальцы ещё раз переутверждаются как final overlay.

Это важно, потому что руки часто конфликтуют с:

- BVH-анимацией;
- manual bone offsets;
- общим arm IK.

### 6. Лицо

Лицо применяет blendshapes и не конфликтует с костями тела.

Поэтому face tracking живёт в том же мокап-проходе, но практически не пересекается с torso/arm solver-ом.

## Запись и экспорт BVH

Проект поддерживает три связанных сценария.

### Обычная live-запись

- `startRecording()`
- покадровое добавление поз в `BvhRecorder`
- `stopRecording()` -> скачать `.bvh`

### Ручной frame-by-frame буфер

- `grabFrame()` добавляет текущий кадр в буфер;
- `flushGrabbed()` выгружает только накопленные кадры.

### Экспорт одной позы

`exportCurrentPoseBvh()` создаёт отдельный временный recorder, снимает текущую позу и скачивает её как `1-frame BVH`.

Это не трогает основной live recorder.

## Как читать `Skeleton Info`

Ниже перечислены самые полезные группы метрик.

### Торс

- `Green sh mid` и `Green hip mid` — performer skeleton в world space debug-визуализации.
- `Norm sh mid` и `Norm hip mid` — положение соответствующих костей аватара после solver-а.
- `Err sh mid` / `Err hip mid` — расхождение между performer и avatar.
- `Err sh axis` / `Err hip axis` — насколько линии плеч и бёдер совпадают по направлению.

Новые solver-метрики:

- `Torso fwd raw` — сырой forward lean из landmarks.
- `Torso fwd applied` — forward lean после baseline и clamping.
- `Torso lat raw` — сырой боковой наклон.
- `Torso lat applied` — то, что реально ушло в spine/chest.
- `Torso lat gain` — какой adaptive gain был выбран для lateral bend.

Как интерпретировать:

- `raw` уже маленький -> проблема во входных landmarks;
- `raw` большой, а `applied` маленький -> проблема в коэффициентах solver-а;
- `applied` правильный, а torso всё равно не наклоняется -> проблема в знаке оси, rest-pose correction или последующем слое.

### Руки

Базовые строки:

- `Blue target` — куда solver хотел поставить кисть.
- `Elbow target` — опорная точка для локтя.
- `Reach` — насколько близко цель к полному выпрямлению цепи.
- `Err elbow G->T` — насколько target локтя совпадает с performer elbow.

Solver-строки:

- `Arm scale raw/eff`
- `Arm scale cap`
- `Midpoint blend`
- `Hands-together`
- `Prayer blend`
- `Face-near blend`
- `Wrist front`
- `Front-pose blend`

Как читать эти значения:

- высокий `Reach` рядом с `100%` -> риск выпрямленных локтей;
- высокий `Hands-together`, но нулевой `Prayer blend` -> кадр ещё не распознан как folded/prayer;
- высокий `Prayer blend`, но руки всё ещё далеко от корпуса -> плохой anchor или слишком сильный `Front-pose blend`;
- ненулевой `Face-near blend` нужен для поз у рта и подбородка.

### Ноги

- `Legs ready`
- `Leg reach`
- `L/R foot`
- `Ankle targets`

Если lower-body кадр хороший, но ноги не совпадают, сначала смотрите calibration и foot lock.

Если lower-body кадра нет, а ноги дёргаются, сначала проверяйте, не активирован ли leg IK по шуму.

## Типовые сбои и что проверять

### Торс не наклоняется в сторону

Смотреть:

- `Green sh mid`
- `Norm sh mid`
- `Torso lat raw`
- `Torso lat applied`
- `Torso lat gain`

Если `raw` почти ноль, проблема во входном кадре.

Если `raw` заметный, а `applied` маленький, проблема в solver gain/clamp.

Если `applied` большой, а визуально torso всё равно стоит, проблема в знаке bend, распределении между `hips` и `spine/chest` или в том, что поздний слой перетирает результат.

### Локти не сгибаются

Смотреть:

- `Reach`
- `Arm scale raw/eff`
- `Arm scale cap`
- `Elbow target`

Чаще всего это означает, что wrist target вышел слишком далеко и IK почти выпрямился.

### Руки сложены перед грудью, но у аватара вытянуты вперёд

Смотреть:

- `Hands-together`
- `Prayer blend`
- `Front-pose blend`
- `Blue target`

Если `Prayer blend` высокий, а `Front-pose blend` тоже остаётся высоким, solver ещё частично считает кадр reach-позой.

### Пальцы или ладонь не совпадают с видео

Смотреть:

- включён ли `Wrist + fingers priority`;
- есть ли обе руки в `Hands detected`;
- выглядит ли performer hand skeleton правильно ещё до ретаргета.

Если performer hand landmarks уже плохие, solver это не исправит.

### Ноги двигаются в upper-body кадрах

Смотреть:

- `Legs ready`
- `Leg length`
- `Ankle targets`

Это почти всегда означает, что в кадре нет надёжных ног, а IK всё равно пытается их решать.

## Файлы, которые чаще всего приходится открывать

- `src/main.ts` — порядок слоёв в кадре
- `src/mocap/mocapController.ts` — orchestration, recording, export
- `src/mocap/directPoseApplier.ts` — torso, arms, legs, hands
- `src/mocap/mocapCalibration.ts` — scale и длины сегментов
- `src/debugPanel.ts` — UI и `Skeleton Info`
- `src/validation/boneValidator.ts` — ROM/clamp слой

## Как обычно дебажить проблему

1. Сначала сравнить performer skeleton и avatar skeleton визуально.
2. Потом открыть `Skeleton Info`.
3. Определить, ломается ли поза уже на target-уровне или после применения в кости.
4. Посмотреть, не перетирает ли результат более поздний слой.
5. Только после этого крутить коэффициенты.

Практический совет: почти всегда быстрее починить не "красивость" конечной позы, а понять, где именно сломалась цепочка:

- входные landmarks;
- calibration;
- target computation;
- IK solve;
- final hand overlay;
- validator / post-layer.
