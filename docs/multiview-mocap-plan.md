# Multi-View Mocap Plan

## Цель

Добавить в `vrm-player` офлайн-пайплайн, который принимает два синхронизированных видео с разных ракурсов, например front и side, восстанавливает более устойчивый 3D-скелет исполнителя и сохраняет результат в существующий формат `.motion.json`.

Главный принцип: не склеивать два видео в одно. Нужно извлечь позу из каждого видео, синхронизировать кадры, объединить 2D/3D данные в один канонический 3D motion clip и дальше использовать уже существующий импорт:

```text
front.mp4 + side.mp4
  -> per-view 2D pose detection
  -> sync
  -> camera calibration / rough alignment
  -> 3D joint fusion
  -> *.multiview.motion.json
  -> parseCanonicalMotionJson()
  -> retargetCanonicalMotionToVrm()
  -> Animation queue / BVH / VRMA export
```

## Почему это стоит делать

Одна камера хорошо видит плоскость изображения, но плохо угадывает глубину. Из-за этого руки, ноги и корпус часто прыгают по Z, особенно при поворотах, скрещенных руках, шаге в сторону камеры и частичных occlusion. Вторая камера закрывает именно эту дыру: front-view лучше держит X/Y, side-view лучше держит depth и forward/back motion.

Для проекта это логично ложится не в live mocap, а в offline import: обработка тяжелее, зато можно делать калибровку, фильтрацию, ручную синхронизацию и экспорт качественного клипа.

## MVP Scope

MVP должен решить только один понятный сценарий:

- один человек в кадре;
- две неподвижные камеры;
- ракурсы примерно front и side, угол между ними 70-110 градусов;
- одинаковый или известный FPS;
- пользователь сам задает sync offset или делает хлопок/резкое движение в начале;
- выходной файл совместим с текущим `.motion.json`;
- ретаргет идет через существующий `src/mocap/offline/motionRetargeter.ts`.

В MVP не нужно делать:

- multi-person;
- realtime;
- автоматическое распознавание произвольного расположения камер;
- пальцы из двух камер;
- SMPL mesh fitting;
- полноценный bundle adjustment UI.

## Существующая база в проекте

Уже есть полезные точки интеграции:

- `tools/offline_mocap/video_to_motion_mediapipe.py` - локальный fallback для одной камеры через MediaPipe.
- `tools/offline_mocap/convert_wham_gvhmr.py` - адаптер внешних offline-моделей в motion JSON.
- `src/mocap/offline/canonicalMotion.ts` - контракт `CanonicalMotionClip`.
- `src/mocap/offline/motionRetargeter.ts` - ретаргет канонического 3D-скелета на VRM.
- `src/animationImport.ts` - импорт `.json` как `motion-json`.
- `docs/offline-mocap-import.md` - описание текущего offline import MVP.

Поэтому новый pipeline лучше добавлять как новый offline tool, а не как большой переписанный live mocap stack.

## Целевой формат данных

Выход должен оставаться каноническим:

```json
{
  "version": 1,
  "name": "dance_multiview",
  "source": "multiview-mediapipe",
  "fps": 30,
  "coordinateSpace": "vrm",
  "frames": [
    {
      "time": 0,
      "root": { "position": [0, 1, 0] },
      "joints": {
        "hips": { "position": [0, 1, 0], "confidence": 0.98 },
        "chest": { "position": [0, 1.35, 0], "confidence": 0.96 },
        "leftHand": { "position": [-0.3, 1.2, 0.15], "confidence": 0.82 }
      },
      "contacts": {
        "leftFoot": true,
        "rightFoot": false
      }
    }
  ],
  "adapter": {
    "views": ["front", "side"],
    "sync": { "sideFrameOffset": 3 },
    "calibration": { "mode": "rough-orthogonal" }
  }
}
```

Важно: `source` сейчас в `CanonicalMotionClip` типизирован ограниченным списком, а `inferSource()` для неизвестных значений возвращает `unknown`. Для нового значения есть два варианта:

- быстро: оставить `source: "unknown"` и положить детали в `adapter`;
- лучше: расширить тип `source` значением `'multiview'` или `'mediapipe-multiview'`.

Для MVP лучше выбрать второй вариант и добавить `source: "multiview"` в TypeScript-контракт сразу. Иначе импорт будет работать, но нельзя будет надежно включать отдельные retarget/cleanup настройки для двухкамерного клипа.

Отдельная оговорка: поле `adapter` полезно сохранять в JSON как provenance metadata, но текущий browser parser его не прокидывает дальше в `CanonicalMotionClip`. Поэтому runtime-логика не должна зависеть от `adapter` до отдельного расширения контракта. Настройки качества и диагностику лучше писать в отдельный `*.fusion.report.json`.

## Этап 1. Подготовить тестовые материалы

Нужно собрать маленький набор видео, иначе pipeline будет невозможно оценивать.

Минимальный набор:

- `front_idle.mp4` + `side_idle.mp4` - стойка и простые движения рук;
- `front_walk.mp4` + `side_walk.mp4` - 2-3 шага на месте или вперед-назад;
- `front_cross_arms.mp4` + `side_cross_arms.mp4` - руки перед корпусом;
- `front_turn.mp4` + `side_turn.mp4` - поворот корпуса на 45-90 градусов.

Требования к съемке:

- камеры неподвижны;
- человек целиком в кадре;
- перед началом есть sync gesture: хлопок, резкий присед или поднятие обеих рук;
- одежда контрастная к фону;
- свет ровный;
- FPS 30 или 60;
- оба видео обрезаны примерно на один и тот же временной диапазон.

Артефакты хранить не обязательно в git, но путь к локальной папке стоит описать в документации или `.gitignore`.

## Этап 2. Новый offline tool

Перед добавлением парного скрипта нужно вынести общие MediaPipe helper'ы из текущего single-video fallback:

```text
tools/offline_mocap/mediapipe_common.py
```

В общий модуль должны уйти:

- landmark index map;
- mirror/left-right remapping;
- `convert_point()`, `midpoint()`, visibility helpers;
- построение derived canonical joints;
- чтение видео с downsample до целевого FPS;
- возврат как финальных joints, так и raw/debug landmarks.

После этого добавить скрипт:

```text
tools/offline_mocap/video_pair_to_motion_mediapipe.py
```

Предлагаемый CLI:

```bash
python tools/offline_mocap/video_pair_to_motion_mediapipe.py ^
  --front path/to/front.mp4 ^
  --side path/to/side.mp4 ^
  --output path/to/out.multiview.motion.json ^
  --fps 30 ^
  --side-offset-frames 0 ^
  --mode rough-orthogonal
```

Параметры MVP:

- `--front` - видео спереди.
- `--side` - видео сбоку.
- `--output` - выходной `.motion.json`.
- `--fps` - целевой FPS.
- `--side-offset-frames` - ручной offset относительно front.
- `--front-mirror-x` / `--side-mirror-x` - контроль зеркальности.
- `--visibility` - порог confidence для MediaPipe landmarks.
- `--max-frames` - быстрые тесты.
- `--mode rough-orthogonal` - первая простая модель с камерами примерно под 90 градусов.

## Этап 3. Per-view pose extraction

Сначала сделать то же, что делает текущий `video_to_motion_mediapipe.py`, но через общий extractor и отдельно для каждой камеры:

```text
front.mp4 -> front frames with landmarks
side.mp4  -> side frames with landmarks
```

Для каждого кадра сохранить:

- frame index;
- time;
- raw MediaPipe world landmarks;
- normalized image landmarks;
- visibility/confidence;
- derived canonical joints: hips, spine, chest, neck, head, arms, legs, feet.

На этом этапе нужно сохранить debug JSON по флагу или рядом с output:

```text
out.front.pose2d.json
out.side.pose2d.json
```

Это поможет понять, ломается ли качество еще до fusion.

Важно: single-video скрипт сейчас пишет только итоговые canonical joints. Для multi-view этого мало: fusion и диагностика должны видеть raw MediaPipe world landmarks, normalized image landmarks и per-landmark visibility.

## Этап 4. Синхронизация

MVP:

- использовать `--side-offset-frames`;
- считать пары кадров как `front[i]` + `side[i + offset]`;
- пропускать пары, где одной стороны нет.

Следующий шаг после MVP:

- автоматический sync по резкому движению wrists/hips;
- вычислять energy curve: сумма скоростей ключевых суставов;
- искать offset с максимальной корреляцией между front и side.

Пример:

```text
front motion energy: wrist/ankle/hip velocity over time
side motion energy:  wrist/ankle/hip velocity over time
best offset = argmax(correlation(front, side))
```

UI позже может показать найденный offset и дать пользователю поправить его вручную.

## Этап 5. Rough orthogonal fusion

Это самый простой полезный вариант без настоящей калибровочной доски.

Идея:

- front-view дает `x` и `y`;
- side-view дает `z` и `y`;
- итоговая высота `y` берется как confidence-weighted average;
- итоговый `x` берется в основном из front;
- итоговый `z` берется в основном из side;
- масштаб side подгоняется по высоте тела и длинам сегментов.

Псевдологика для joint:

```text
front joint = [xf, yf, zf]
side joint  = [xs, ys, zs]

x = xf
y = weightedAverage(yf, ys, frontConfidence, sideConfidence)
z = sideDepthFromSideView(xs or zs, calibratedScale)
confidence = combine(frontConfidence, sideConfidence)
```

Нужно выбрать, какую ось MediaPipe side-view использовать как глубину. Это придется проверить экспериментально, потому что текущий fallback уже делает `convert_point(): [x, -y, -z]`, а side-camera координаты будут иметь другую семантику относительно avatar world.

Практичный MVP:

- сделать настройки `--side-depth-axis x|z|-x|-z`;
- сделать `--depth-scale`;
- сделать `--depth-offset`;
- подобрать дефолт на тестовом видео.

Не фиксировать дефолтную ось в плане до проверки на реальной паре клипов. MediaPipe `pose_world_landmarks` для front и side не находятся в общей мировой системе, поэтому rough-orthogonal fusion является эвристикой, а не физической triangulation.

## Этап 6. Нормализация координат

Итоговый clip должен быть в координатах, которые уже понимает `retargetCanonicalMotionToVrm()`:

- Y вверх;
- X влево/вправо исполнителя;
- Z вперед/назад;
- `hips` как root position;
- высота примерно в метрах или хотя бы стабильно пропорциональна телу.

Нормализация:

1. Найти первый надежный кадр.
2. Вычислить центр бедер как origin reference.
3. Оценить высоту: `head.y - min(leftFoot.y, rightFoot.y)`.
4. Привести масштаб к условной высоте 1.6-1.8 или оставить в MediaPipe meters, если они стабильны.
5. Отцентрировать root motion относительно первого кадра.
6. Стабилизировать пол: минимальная высота стоп не должна плавать слишком сильно.

## Этап 7. Confidence и fallback rules

Fusion не должен слепо доверять обеим камерам.

Правила:

- если joint виден в обеих камерах, использовать fused 3D;
- если виден только front, сохранить front-based позицию с ослабленным Z;
- если виден только side, сохранить side-based depth, но X брать из последнего надежного значения;
- если joint потерян в обеих камерах, интерполировать короткие пропуски;
- если пропуск длинный, удерживать последнюю позу с падающим confidence.

Пример confidence:

```text
combined = 1 - (1 - frontConfidence) * (1 - sideConfidence)
```

Для рук и ног стоит хранить более строгий confidence, потому что ошибочная кисть или стопа хуже, чем временно сглаженная.

## Этап 8. Фильтрация и cleanup

До импорта в браузер нужно сгладить шум.

Минимально:

- One Euro filter или exponential smoothing для joint positions;
- clamp невозможных длин сегментов;
- интерполяция дырок до 5-8 кадров;
- foot contact detection;
- root smoothing отдельно от limbs.

Уже есть `src/mocap/offline/motionCleanup.ts`, но часть cleanup удобнее делать в Python до записи JSON, потому что там видны исходные confidence и per-view данные.

Критичные проверки:

- длина плечо-локоть не должна сильно меняться между кадрами;
- длина бедро-колено не должна сильно меняться;
- стопы не должны дрожать по Y, когда contact=true;
- hips не должны прыгать из-за одного плохого side кадра.

## Этап 9. Интеграция в docs и importer

Документация:

- обновить `docs/offline-mocap-import.md`;
- добавить пример команды для двух камер;
- объяснить, что результат грузится тем же drag-drop путем.

Код:

- расширить `CanonicalMotionClip['source']` значением `'multiview'`;
- добавить `multiview` в `inferSource()`;
- возможно, для `source === 'multiview'` включить другие `OfflineRetargetOptions` в `src/animationImport.ts`.

Предлагаемые опции:

```ts
if (motion.source === 'multiview') {
  offlineOpts.positionSmoothingAlpha = 0.25;
  offlineOpts.rootMotionMode = 'horizontal';
}
```

Но это надо проверять на тестовых клипах. Для танца `horizontal` может быть лучше, для motion capture на месте можно оставить `locked`.

Минимальный кодовый MVP для импорта:

- parser принимает `source: "multiview"`;
- importer не ломается на `.multiview.motion.json`;
- отдельные retarget options включаются только после визуальной проверки, а не заранее.

## Этап 10. Debug outputs

Нужно сразу сделать debug, иначе fusion будет сложно чинить.

Скрипт должен уметь писать:

- `*.front.pose.json` - per-view joints front;
- `*.side.pose.json` - per-view joints side;
- `*.fusion.report.json` - статистика confidence, пропуски, offset, scale;
- `*.multiview.motion.json` - итоговый клип.

Debug outputs должны быть частью MVP, а не polish-этапом. Без них будет трудно понять, где именно испортился результат: в детекции, sync, выборе осей, scale или cleanup.

В report добавить:

```json
{
  "framesRead": { "front": 300, "side": 298 },
  "framesWritten": 290,
  "sync": { "sideOffsetFrames": 3 },
  "calibration": {
    "mode": "rough-orthogonal",
    "sideDepthAxis": "x",
    "depthScale": 1.0
  },
  "jointStats": {
    "leftHand": { "missingFrames": 12, "meanConfidence": 0.78 }
  }
}
```

## Этап 11. Tests

Python script tests:

- tiny synthetic two-view landmark sequence;
- sync offset applies correctly;
- missing joint fallback works;
- side depth axis/scale меняют только ожидаемую координату;
- report содержит framesRead/framesWritten, calibration и jointStats;
- output JSON parses through `parseCanonicalMotionJson()`.

TypeScript regression tests:

- `parseCanonicalMotionJson()` accepts `source: "multiview"` if source type is expanded;
- `inferSource()` maps `multiview-mediapipe` or `mediapipe-multiview` to `multiview`;
- dense/fused frames with confidence survive cleanup;
- retargeter produces tracks for hips, torso, arms, legs.

Manual QA:

- run generated `.motion.json` through app;
- compare with single-camera MediaPipe output;
- inspect foot sliding;
- inspect crossed arms;
- inspect turn and side steps;
- export BVH/VRMA if needed.

## Этап 12. Better calibration после MVP

После rough-orthogonal MVP добавить настоящий calibration mode.

Вариант A: ChArUco/OpenCV

- пользователь снимает калибровочную доску обеими камерами;
- OpenCV считает intrinsics/extrinsics;
- 2D landmarks triangulate через camera matrices;
- качество заметно выше, но setup сложнее.

Вариант B: manual scene calibration

- пользователь задает расстояние между двумя точками на полу;
- отмечает направление front/side;
- система подгоняет scale и axes;
- проще для обычного пользователя.

Вариант C: auto body calibration

- использовать T-pose/A-pose в начале;
- оценить оси по плечам, бедрам и вертикали;
- менее точно, но удобно.

Идеальный долгосрочный путь:

```text
rough-orthogonal MVP
  -> manual sync UI
  -> ChArUco calibration import
  -> true triangulation
  -> optional external solver integration: FreeMoCap / EasyMocap
```

## Этап 13. UI в приложении

Сначала можно обойтись CLI. Потом добавить UI в Capture / Anim export:

- режим `Offline multi-view`;
- два file inputs: Front video и Side video;
- numeric input `Side offset frames`;
- select `Side depth axis`;
- slider `Depth scale`;
- кнопка `Generate motion JSON`;
- progress/status;
- drag/drop результата в очередь.

Важно: браузерный MediaPipe может обработать видео, но тяжелый dual-video pipeline проще и надежнее держать в Python CLI. UI может сначала просто описывать команду или запускаться как external tool в будущем.

## Риски

- MediaPipe world landmarks из разных камер не являются одной общей world-системой.
- Без калибровки depth будет эвристическим, не физически точным.
- Side-view часто путает левую и правую сторону при поворотах.
- Occlusion рук перед корпусом все равно останется сложной.
- Разный rolling shutter/FPS даст микросдвиги.
- Ретаргет может выглядеть хуже, если fused skeleton шумный, даже если он "3D".

## Критерии готовности MVP

MVP можно считать готовым, если:

- команда с двумя видео создает валидный `.multiview.motion.json`;
- файл грузится текущим импортом `.json`;
- на простых движениях рук depth лучше, чем у single-camera fallback;
- при шаге вперед/назад hips и feet двигаются правдоподобнее;
- crossed-arms не разваливаются хуже, чем single-camera;
- есть report с понятной статистикой качества;
- весь pipeline описан в `docs/offline-mocap-import.md`.

## Рекомендуемый порядок разработки

1. Добавить `source: "multiview"` в TypeScript-контракт и parser tests.
2. Вынести общую MediaPipe extraction логику из `video_to_motion_mediapipe.py`, чтобы не дублировать landmark mapping.
3. Создать `video_pair_to_motion_mediapipe.py` с CLI и чтением двух видео через общий extractor.
4. Сохранять per-view debug outputs до fusion.
5. Добавить ручной sync offset.
6. Реализовать rough-orthogonal fusion с настройками depth axis/scale/offset.
7. Записать итоговый `.multiview.motion.json`.
8. Записать `*.fusion.report.json`.
9. Прогнать через текущий app import.
10. Добавить базовые Python и TypeScript tests.
11. Обновить `docs/offline-mocap-import.md`.
12. Только после этого думать о настоящей calibration/triangulation.

## Первые конкретные задачи

- [x] Добавить `source: "multiview"` в `CanonicalMotionClip`.
- [x] Добавить обработку `multiview` в `inferSource()`.
- [x] Добавить regression test на parse/import `source: "multiview"`.
- [x] Вынести helper-функции из `video_to_motion_mediapipe.py` в общий модуль `tools/offline_mocap/mediapipe_common.py`.
- [x] Сохранить совместимость существующего `video_to_motion_mediapipe.py` после refactor.
- [x] Добавить `tools/offline_mocap/video_pair_to_motion_mediapipe.py`.
- [x] Добавить per-view debug JSON и fusion report.
- [x] Добавить sample command в `docs/offline-mocap-import.md`.
- [x] Создать один локальный тестовый pair clip и прогнать до `.motion.json`.
- [ ] Сравнить single-camera и multi-view на одном движении.
