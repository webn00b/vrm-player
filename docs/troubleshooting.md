# Troubleshooting и отладка

Этот документ нужен для практической диагностики.

Если вам нужен пользовательский сценарий запуска, откройте [user-guide.md](./user-guide.md).

Если нужен технический разбор внутреннего пайплайна, откройте [mocap-pipeline.md](./mocap-pipeline.md).

Если нужно понять, где в коде живёт нужная подсистема, откройте [architecture.md](./architecture.md).

## Что собирать перед отладкой

Минимальный набор:

- скриншот кадра;
- `Skeleton Info`;
- если нужно, `Debug record`;
- описание, что именно визуально не совпадает.

Лучший набор:

1. Скриншот с видео и 3D-скелетом в одном кадре.
2. Полный `Skeleton Info`.
3. Пояснение, что именно не совпало:
   - торс;
   - локти;
   - кисти;
   - пальцы;
   - ноги;
   - replay BVH.

## Порядок диагностики

Почти всегда быстрее идти так:

1. Сравнить performer skeleton и avatar skeleton глазами.
2. Проверить `Skeleton Info`.
3. Понять, сломался ли target или уже итоговые кости.
4. Проверить, не перетирает ли нужную позу более поздний слой.
5. Только потом крутить коэффициенты.

## Что означают основные блоки `Skeleton Info`

### Torso diagnostic

Ключевые строки:

- `Green sh mid`
- `Green hip mid`
- `Norm sh mid`
- `Norm hip mid`
- `Err sh axis`
- `Err hip axis`
- `Torso fwd raw`
- `Torso fwd applied`
- `Torso lat raw`
- `Torso lat applied`
- `Torso lat gain`

Как читать:

- `raw` почти ноль — проблема уже во входном кадре;
- `raw` большой, а `applied` маленький — solver недодаёт наклон;
- `applied` заметный, но визуально torso всё равно не двигается — проблема в знаке, распределении bend-а или позднем слое.

### Arm diagnostic

Ключевые строки:

- `Reach`
- `Blue target`
- `Elbow target`
- `Arm scale raw/eff`
- `Arm scale cap`
- `Midpoint blend`
- `Hands-together`
- `Prayer blend`
- `Face-near blend`
- `Wrist front`
- `Front-pose blend`

Как читать:

- `Reach` около `100%` — риск выпрямленных локтей;
- `Arm scale raw` сильно выше `100%` — калибровка могла переоценить руку;
- `Hands-together` высокий, а `Prayer blend` ноль — folded pose ещё не распознана;
- `Prayer blend` высокий, но `Front-pose blend` тоже высокий — руки всё ещё считаются выносом вперёд;
- `Face-near blend` нужен для рук у рта, губ или подбородка.

### Ноги

Ключевые строки:

- `Legs ready`
- `Leg length`
- `Ankle targets`
- `Leg reach`
- `L foot`
- `R foot`

Как читать:

- `Legs ready: —` или `Leg length: 0` — lower-body в кадре фактически нет;
- при этом движущиеся ноги обычно означают, что leg IK питается шумом;
- если обе стопы `locked`, а корпус сильно смещается, это может мешать естественному движению ног.

## Частые симптомы

### Торс не наклоняется в сторону

Смотреть:

- `Green sh mid` против `Norm sh mid`
- `Torso lat raw`
- `Torso lat applied`
- `Torso lat gain`

Обычно это один из вариантов:

- landmarks не дают нужный боковой наклон;
- solver режет lateral bend слишком сильно;
- bend применяется в неверном знаке;
- наклон ушёл в плечи, но не дошёл до spine/chest.

### Торс вращается вслед за камерой

Смотреть:

- `Torso fwd raw`
- `Torso fwd applied`
- общую ориентацию плечевого пояса

Обычно причина в camera-space depth bias:

- слишком прямое использование `z` из видео;
- baseline считается неверно;
- плечи берут лишний depth вместо реального torso bend.

### Руки сложены перед грудью, а у аватара вытянуты вперёд

Смотреть:

- `Hands-together`
- `Prayer blend`
- `Front-pose blend`
- `Blue target`

Типичный паттерн:

- `Prayer blend` уже высокий, но `Front-pose blend` всё ещё тянет цель вперёд;
- wrist target остаётся anchored к плечам, а не к chest/neck;
- IK не даёт рукам сложиться ближе к телу.

### Пальцы должны доходить до губ, но у аватара не доходят

Смотреть:

- `Face-near blend`
- `Prayer blend`
- `Blue target`
- положение `Norm wrist`

Если `Face-near blend` ноль, solver ещё не распознал "руки у лица".

Если `Face-near blend` есть, а кисть всё равно низко, значит anchor к `neck/head` ещё недостаточно сильный.

### Локти не сгибаются

Смотреть:

- `Reach`
- `Arm scale raw/eff`
- `Arm scale cap`
- `Elbow target`

Почти всегда это значит:

- wrist target слишком далеко;
- effective scale завышен;
- IK решает цепь почти в прямую линию.

### Пальцы и ладони не совпадают с видео

Смотреть:

- включён ли `Wrist + fingers priority`;
- какие руки реально есть в `Hands detected`;
- правильно ли выглядит performer hand skeleton;
- не теряет ли трекер руку из-за окклюзии.

Если hand landmarks уже плохие на входе, дальнейший solver это не исправит.

### Ноги двигаются, хотя их нет в кадре

Смотреть:

- `Legs ready`
- `Leg length`
- `Ankle targets`

Если ноги в видео не видны, правильное поведение — neutral fallback, а не live leg IK.

### После остановки мокапа исчезает скелет

Если такое поведение снова появится, проверяйте:

- сохраняется ли последний `latestFrame`;
- не очищается ли debug skeleton на transition в `off`;
- не зависит ли отображение от live state вместо cached frame.

## Полезные сочетания признаков

### `Hands-together` высокий + `Prayer blend` высокий + `Front-pose blend` высокий

Значит solver распознал folded pose, но часть логики всё ещё считает её forward reach-позой.

### `Prayer blend` высокий + `Reach` высокий

Значит руки якобы сложены, но target всё ещё слишком далеко, и IK почти выпрямляет локоть.

### `Torso lat raw` заметный + `Torso lat applied` почти ноль

Значит проблема в clamping/gain, а не в landmarks.

### `Torso lat applied` заметный + torso визуально почти прямой

Значит проблема уже после расчёта bend-а:

- знак оси;
- распределение между тазом и spine/chest;
- другой слой перетирает результат.

## Когда нужен `Debug record`

Используйте `Debug record`, если обычного `Skeleton Info` уже мало.

Он особенно полезен, когда:

- ошибка плавающая и проявляется только на части кадров;
- нужно сравнить target и финальную кость по времени;
- баг проявляется только после validator-а или hand overlay.

## Куда смотреть в коде

- `src/main.ts` — порядок слоёв
- `src/mocap/mocapController.ts` — состояния, запись, экспорт
- `src/mocap/directPoseApplier.ts` — torso, arms, hands, legs
- `src/mocap/mocapCalibration.ts` — scale и длины сегментов
- `src/debugPanel.ts` — сборка `Skeleton Info`
- `src/validation/boneValidator.ts` — clamp и ROM
