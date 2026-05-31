# VRM Player

Локальное веб-приложение для просмотра, ретаргета, записи и диагностики анимаций на VRM-аватарах.

Проект полезен, когда нужно:

- быстро проверить `.bvh`, `.vrma`, `.fbx` или motion `.json` на конкретной VRM-модели;
- наложить MediaPipe-мокап с камеры или видео на аватара;
- записать текущую позу или готовый клип обратно в `.bvh`;
- отладить solver, rest-pose correction, кости, IK, пальцы и порядок pose-слоев;
- подготовить JSON/agent_ogi-экспорт или проверить locale-specific host VRM.

## Быстрый старт

### Требования

- Node.js 18+
- npm

### Установка и запуск

```bash
npm install
npm run dev
```

Vite поднимает приложение на [http://127.0.0.1:5333](http://127.0.0.1:5333).

### Первый запуск

1. Запустите `npm run dev`.
2. Откройте вкладку `Player`.
3. Нажмите `Show avatar`, чтобы показать модель.
4. Нажмите `Add animation` или перетащите файл анимации в очередь.
5. Используйте `Play`, `Capture` и `Inspect` режимы верхней панели под текущую задачу.

По умолчанию приложение берет первый VRM из `public/models/index.json`. Если нужно загрузить модель вручную, нажмите `Load VRM`.

## Ассеты

### VRM-модель по умолчанию

Файлы лежат в `public/models/` и раздаются Vite как `/models/...`.

`public/models/index.json` должен быть JSON-массивом имен `.vrm` файлов:

```json
["en_0.vrm", "sample.vrm"]
```

При старте берется первый файл после алфавитной сортировки. Для локальной разовой проверки можно не менять индекс и загрузить `.vrm` через кнопку `Load VRM`.

### Анимации

Анимации добавляются во время работы приложения:

- кнопкой `Add animation`;
- drag-and-drop в очередь;
- через `Capture -> Anim export`;
- из `Retarget Lab`;
- автоматически после некоторых capture/export сценариев.

Поддерживаемые входы основного плеера:

- `.bvh`
- `.vrma`
- `.fbx`
- `.json` в формате channel animation или canonical/offline motion

Папка `animations/` может использоваться как локальное хранилище примеров, но текущий UI не сканирует ее автоматически при старте.

## Основные страницы

### Player

Главная сцена с VRM, очередью клипов и рабочими режимами:

- `Play` - воспроизведение очереди и быстрые действия;
- `Capture` - live/video/multi-view/animation export сценарии;
- `Inspect` - debug-панели, skeleton overlay, bone drag и диагностика.

Очередь умеет добавлять, удалять, переупорядочивать, дублировать и переименовывать клипы. В export-режиме можно выгружать загруженные клипы как `.bvh`, `.glb`, `.vrma` или agent JSON, если для формата есть достаточно исходных данных.

### Retarget

`Retarget Lab` анализирует `.bvh`, `.fbx` и `.vrma`, показывает соответствие source/target костей, позволяет сравнивать preview, добавлять quaternion corrections и сохранять presets. Готовый результат можно добавить в очередь.

### Export

Страница инструментов:

- `Animation -> JSON` конвертирует `.fbx`, `.bvh`, `.glb`, `.gltf`, `.vrma` в переносимый JSON;
- `Re-export` повторяет export-действия для текущей очереди.

У проекта также есть отдельная Vite-страница `exports.html` для легкого standalone-конвертера.

### Hosts

Превью locale-specific VRM-хостов. Профили описаны в `src/languageHosts.ts`, модели лежат в `public/models/hosts/<locale>/host.vrm`.

Документация: [docs/language-hosts.md](docs/language-hosts.md).

## Capture-сценарии

### Live

`Capture -> Live` запускает камеру, показывает performer skeleton и может записывать результат в BVH.

Полезные настройки находятся в панели `Capture` и debug-панелях:

- mirror/selfie режим;
- face tracking;
- hip position;
- smoothing;
- wrist/finger priority;
- validation/clamp и диагностические overlays.

### Video BVH

`Capture -> Video BVH` обрабатывает видеофайл через MediaPipe, записывает BVH и добавляет результат в очередь. В этом режиме удобно сравнивать исходное видео, debug skeleton, записанный BVH и повторный playback.

Для покадровой проверки доступны pause/step/grab/flush действия, а текущую позу можно выгрузить как `1-frame BVH` или как `BVH + agent_ogi JSON`.

### Multi-view

`Capture -> Multi-view` принимает фронтальное и боковое видео, генерирует browser `.motion.json`, скачивает отчет fusion и сразу импортирует motion JSON в очередь.

Подробнее: [docs/offline-mocap-import.md](docs/offline-mocap-import.md).

### Anim Export

`Capture -> Anim export` берет текущую очередь или выбранный animation/motion файл и записывает результат в BVH через production-позу аватара. Это полезно для проверки round-trip: импорт, ретаргет, запись, повторный импорт.

## Как собирается итоговая поза

Порядок слоев живет в `src/renderLoop.ts`. На момент актуализации README кадр собирается примерно так:

1. `AnimationController.update(delta)` для BVH/VRMA/FBX/motion клипа.
2. Optional extra mixer из `renderLoopHooks`.
3. Idle/procedural слой, если основной animation controller muted или пуст.
4. Live mocap overlay, если активный клип не играет.
5. Ручные bone offsets и in-scene bone drag.
6. Финальный wrist/finger overlay из hand tracking.
7. Validator clamp для live/captured/playback позы.
8. Skeleton logger, BVH recorder capture и debug recorder.
9. Performer debug skeleton.
10. Micro-animations и hip balance corrector.
11. `vrm.update(delta)`.
12. Export/verifier/motion-trace hooks.
13. Hip force diagnostics, skeleton overlay, controls update и render.

Практический смысл: если поза выглядит неправильно, сначала нужно понять, на каком слое ошибка появляется. Debug skeleton показывает performer/target сторону, а final VRM поза уже включает retarget, offsets, validator и VRM update.

## Документация

- [docs/user-guide.md](docs/user-guide.md) - пользовательский сценарий работы.
- [docs/troubleshooting.md](docs/troubleshooting.md) - диагностика по симптомам и чтение debug-панелей.
- [docs/mocap-pipeline.md](docs/mocap-pipeline.md) - технический разбор MediaPipe/mocap pipeline.
- [docs/architecture.md](docs/architecture.md) - карта модулей и потоков данных.
- [docs/animation-validation.md](docs/animation-validation.md) - validation и проверки анимаций.
- [docs/offline-mocap-import.md](docs/offline-mocap-import.md) - offline/GVHMR/WHAM/multi-view импорт.
- [docs/language-hosts.md](docs/language-hosts.md) - locale-specific host avatars.
- [docs/roadmap.md](docs/roadmap.md) - backlog и следующие направления.

Часть документов может быть более детальной, чем README, но при расхождениях стоит сверяться с текущим кодом в `src/player/modules/` и `src/renderLoop.ts`.

## Карта проекта

Основной стек:

- Vite
- TypeScript
- Vue 3
- Three.js
- `@pixiv/three-vrm`
- `@pixiv/three-vrm-animation`
- MediaPipe Tasks Vision
- PrimeVue
- Vitest, Playwright, Madge

Ключевые области:

- `src/main.ts` - входная точка и запуск player modules.
- `src/player/modules/` - bootstrap-модули сцены, VRM, playback, UI, mocap, debug и render loop.
- `src/renderLoop.ts` - production порядок pose/render слоев.
- `src/vrmLoader.ts` - загрузка VRM.
- `src/animationImport.ts` и `src/animationLoaders/` - импорт BVH/VRMA/FBX/JSON.
- `src/retarget.ts`, `src/skeletonMap.ts`, `src/humanoidRestPose.ts` - BVH/VRMA retarget и rest corrections.
- `src/mocap/pipeline/` - MediaPipe controller/detector.
- `src/mocap/solvers/` - torso/arm/leg/IK solver math.
- `src/mocap/retargeters/` - применение позы к VRM.
- `src/mocap/bvh/` и `src/bvhExportRecorder.ts` - запись и round-trip BVH.
- `src/playerVue/` - Vue UI: shell, queue, capture, retarget lab, hosts, panels.
- `src/exports/` - standalone animation-to-JSON converter.
- `public/mediapipe/` - локальные MediaPipe wasm/task ассеты.
- `public/models/` - дефолтные VRM и language host models.
- `tests/e2e/` - Playwright-тесты UI/capture сценариев.

## Команды разработки

```bash
npm run dev
npm run build
npm run preview
npm test
npm run test:circular
npm run test:regression
npm run test:e2e
```

Для первого запуска Playwright:

```bash
npx playwright install chromium
```

Для e2e с реальным видео мокапа можно передать `FAKE_VIDEO_PATH`; детали есть в [tests/e2e/README.md](tests/e2e/README.md).

## Типичный цикл отладки

1. Воспроизвести проблему на минимальном клипе, видео или single-frame pose.
2. Сравнить performer skeleton, target/debug данные и итоговую VRM-позу.
3. Проверить, активен ли BVH playback, mocap overlay, manual offset, validator или hand overlay.
4. Если ошибка в источнике, смотреть MediaPipe/solver diagnostics.
5. Если source выглядит правильно, смотреть retarget/rest correction/validator.
6. После правки прогнать узкий Vitest файл, затем `npm run build` или `npm run test:regression` при широком изменении.

## Ограничения

- MediaPipe может шуметь по глубине и терять кисти при окклюзии.
- Upper-body видео плохо подходят для честного leg IK.
- Сильно стилизованные пропорции аватара требуют осторожной калибровки.
- Нестандартный rest pose модели иногда требует дополнительных corrections.
- `.vrma` export доступен только там, где есть исходный BVH или поддерживаемый путь экспорта.
- Multi-view режим сейчас является практичным MVP, а не полноценной calibrated-triangulation системой.
