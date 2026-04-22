# VRM Player

Это небольшой локальный инструмент для работы с VRM-аватаром.

Простыми словами:

- вы кладете в проект `.vrm` модель и `.bvh` анимации;
- запускаете приложение;
- смотрите, как аватар проигрывает анимации;
- при желании включаете мокап с камеры или из видео;
- можете записать результат обратно в `.bvh` или скачать текущую позу как `1-frame BVH`.

Проект полезен в двух сценариях:

1. Вы хотите быстро смотреть и отлаживать BVH-анимации на VRM-модели.
2. Вы хотите ретаргетить мокап из MediaPipe на VRM и разбираться, где именно ломается поза.

## Что умеет проект

- Загружает первый `.vrm` из папки `models/`.
- Автоматически подхватывает все `.bvh` из папки `animations/`.
- Проигрывает BVH-клипы в очереди с кроссфейдами.
- Поверх анимации накладывает live mocap с камеры или видеофайла.
- Ретаргетит руки и пальцы через отдельный пайплайн с калибровкой и IK.
- Показывает debug-панель с диагностикой торса, рук, ног и калибровки.
- Записывает мокап в `.bvh`.
- Экспортирует текущую позу как отдельный `1-frame BVH`.

## Быстрый старт

### Требования

- Node.js 18+
- npm

### Установка и запуск

```bash
npm install
npm run dev
```

Приложение откроется на [http://127.0.0.1:5333](http://127.0.0.1:5333).

### Самый короткий путь

1. Положите `.vrm` в `models/`.
2. Положите `.bvh` в `animations/`.
3. Запустите `npm run dev`.
4. Откройте вкладку `Main` и включите `Show model`.
5. Перетащите клипы из `Library` в `Queue`.

Если в `animations/` ничего нет, проект все равно запустится. В этом режиме можно использовать idle и мокап без BVH-библиотеки.

## Структура ассетов

### VRM

- Папка: `models/`
- Формат: `.vrm`
- Берется первый файл по алфавиту

Пример:

```text
models/
  avatar.vrm
```

Источники тестовых моделей:

- [VRoid sample avatars](https://vroid.pixiv.help/hc/en-us/articles/4402394424089)
- [VRM specification samples](https://github.com/vrm-c/vrm-specification/tree/master/samples)

### BVH

- Папка: `animations/`
- Формат: `.bvh`
- Подхватываются автоматически при старте
- Порядок по умолчанию: алфавитный

Пример:

```text
animations/
  01-idle.bvh
  02-walk.bvh
  03-wave.bvh
```

## Как пользоваться

## 1. Проигрывание BVH

1. Добавьте анимации в `animations/`.
2. Запустите проект.
3. В правой панели перетащите нужные анимации в очередь.
4. Используйте transport для проигрывания, прыжка по очереди и проверки кроссфейдов.

## 2. Мокап с камеры

Вкладка `Video`:

1. Нажмите `Start`.
2. Разрешите доступ к камере.
3. При необходимости включите `Show model`, чтобы видеть аватара.
4. Для записи нажмите `Rec`.

Полезные переключатели:

- `Mirror mode` - селфи-режим
- `Face tracking` - blendshapes лица
- `Hip position` - перенос таза по позиции
- `1€ smoothing` - сглаживание landmark'ов
- `Wrist + fingers priority` - кисти и пальцы остаются верхним слоем

## 3. Мокап из видеофайла

Вкладка `Video`:

1. Нажмите `Load`.
2. Выберите видеофайл.
3. Проект прогонит ролик, построит мокап и автоматически скачает записанный `.bvh`.
4. После этого новый BVH автоматически появится в очереди и может быть тут же проигран на той же модели.

Это удобно для сравнения:

- что показывал live-мокап;
- что получилось после записи в BVH;
- что вернулось после ретаргета BVH обратно на VRM.

## 4. Пошаговый просмотр видео

Если загружен видеофайл, можно:

- ставить на паузу;
- шагать по кадрам вперед и назад;
- брать текущую позу;
- скачивать собранный вручную BVH.

Кнопки в playback-строке:

- `⏸` / `▶` - пауза
- `⏮` - шаг назад
- `⏭` - шаг вперед
- `💾` - добавить текущий кадр в буфер ручной записи
- `⬇` - скачать буфер ручной записи как `.bvh`

## 5. Экспорт текущей позы

Во вкладке `Video` есть отдельная кнопка:

- `Current pose -> Export .bvh`

Она скачивает текущую позу аватара как отдельный `1-frame BVH`.

Это полезно, когда нужно:

- сохранить проблемный кадр;
- быстро отдать позу в другой инструмент;
- сравнить "как выглядит сейчас" без полной записи ролика.

Важно:

- экспорт берется из текущего состояния аватара;
- он не трогает основной recorder;
- его можно использовать отдельно от обычной записи мокапа.

## Откуда берется итоговая поза

Каждый кадр в проекте собирается слоями:

1. BVH-анимация через `AnimationMixer`
2. idle / procedural анимации
3. live mocap
4. ручные оффсеты костей
5. финальный overlay кистей и пальцев
6. validator ROM
7. micro-animations и `vrm.update()`

Это важно понимать при отладке:

- если live mocap "не побеждает" BVH, значит ошибка в порядке слоев;
- если проблема видна уже на debug skeleton, то баг раньше, чем ретаргет;
- если debug skeleton выглядит правильно, а аватар нет, то проблема уже в solver/retarget.

## Диагностика и debug

В проекте много встроенной диагностики.

### Основные инструменты

- `Performer skeleton` - зеленый debug-скелет перформера
- `Skeleton Info` - текстовый дамп по торсу, рукам, ногам и solver-метрикам
- `Debug record` - запись внутренних данных в JSON
- `Validation (ROM)` - контроль анатомических ограничений

### Что смотреть в первую очередь

Если ломается торс:

- `Green sh mid`
- `Norm sh mid`
- `Err sh axis`
- `Err hip axis`
- `Torso fwd raw`
- `Torso fwd applied`
- `Torso lat raw`
- `Torso lat applied`
- `Torso lat gain`

Если ломаются руки:

- `Reach`
- `Blue target`
- `Elbow target`
- `Arm scale raw/eff`
- `Hands-together`
- `Prayer blend`
- `Face-near blend`
- `Front-pose blend`

Если ломаются ноги:

- `Legs ready`
- `Ankle targets`
- `Leg reach`
- foot lock (`locked/free`)

## Ограничения

Сейчас проект хорошо подходит для отладки, но у него есть понятные границы.

### Что уже работает неплохо

- обычные BVH на бипедах;
- live mocap для торса и рук;
- upper-body видео;
- prayer / folded hands / hand-near-face кейсы лучше, чем в базовом angle-only ретаргете;
- экспорт текущей позы и запись мокапа в BVH.

### Что может ломаться

- A-pose vs T-pose на модели и источнике;
- очень шумный Z из MediaPipe;
- частичная окклюзия рук и пальцев;
- сильные стилизованные пропорции аватара;
- видео, где ноги почти не видны, но включен full-body режим;
- экстремальные позы, где landmark'и сами ошибаются.

### Что важно помнить

- hand tracking не гарантирует идеальное совпадение пальцев с видео на каждом кадре;
- `bodyScale`, `armScale`, `legScale` зависят от качества калибровки;
- если модель экспортирована с нестандартным rest pose, иногда нужен дополнительный rest correction.

## Как устроен проект

### Основные файлы

- [src/main.ts](/Users/fedor/projects/personal/vrm-player/src/main.ts) - сборка приложения и порядок слоев в render loop
- [src/debugPanel.ts](/Users/fedor/projects/personal/vrm-player/src/debugPanel.ts) - вся debug UI и `Skeleton Info`
- [src/mocap/mocapController.ts](/Users/fedor/projects/personal/vrm-player/src/mocap/mocapController.ts) - orchestration камеры, видео, записи и экспорта
- [src/mocap/directPoseApplier.ts](/Users/fedor/projects/personal/vrm-player/src/mocap/directPoseApplier.ts) - основной solver мокапа
- [src/mocap/mocapCalibration.ts](/Users/fedor/projects/personal/vrm-player/src/mocap/mocapCalibration.ts) - калибровка пропорций
- [src/mocap/twoBoneIK.ts](/Users/fedor/projects/personal/vrm-player/src/mocap/twoBoneIK.ts) - IK для рук и ног
- [src/mocap/bvhRecorder.ts](/Users/fedor/projects/personal/vrm-player/src/mocap/bvhRecorder.ts) - запись BVH
- [src/retarget.ts](/Users/fedor/projects/personal/vrm-player/src/retarget.ts) - BVH -> VRM retarget
- [src/skeletonMap.ts](/Users/fedor/projects/personal/vrm-player/src/skeletonMap.ts) - структурный маппинг костей BVH
- [src/validation/](/Users/fedor/projects/personal/vrm-player/src/validation) - validator вращений костей

### Внешние зависимости

- `three`
- `@pixiv/three-vrm`
- `@pixiv/three-vrm-animation`
- `@mediapipe/tasks-vision`
- `kalidokit`

## Документация

- [docs/mocap-pipeline.md](/Users/fedor/projects/personal/vrm-player/docs/mocap-pipeline.md) - технический разбор пайплайна мокапа и ретаргета

## Разработка

### Команды

```bash
npm run dev
npm run build
npm run preview
```

### Перед изменениями

Если вы меняете solver или ретаргет, обычно полезно проверить:

1. Как выглядит зеленый performer skeleton.
2. Что показывает `Skeleton Info`.
3. Как выглядит записанный `.bvh` после auto-replay.
4. Не начал ли validator постоянно clamp'ить одну и ту же кость.

### Типичный цикл отладки

1. Воспроизвести проблему на видео.
2. Скопировать `Skeleton Info`.
3. Проверить, где именно ломается:
   - landmarks;
   - target;
   - final normalized bones;
   - replay из записанного BVH.
4. Править только один слой за раз.

## Как получить BVH из Mixamo

1. Откройте [Mixamo](https://www.mixamo.com).
2. Возьмите `Y Bot` или другой стандартный biped.
3. Скачайте анимацию как `FBX Binary`, `Without Skin`, `30 fps`.
4. Импортируйте в Blender.
5. Экспортируйте как `.bvh`.
6. Положите файл в `animations/`.

## Что еще можно улучшить

Если захотите продолжить проект, самые очевидные направления такие:

- вынести документацию в отдельный user guide и troubleshooting guide;
- добавить импорт/экспорт поз не только в `BVH`, но и в `JSON`/`VRMA`;
- сделать явные preset'ы для upper-body и full-body видео;
- сохранить пользовательские настройки debug/mocap между сессиями.
