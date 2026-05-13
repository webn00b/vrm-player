# Roadmap

Этот файл нужен как рабочий backlog по улучшению проекта.

Статусы:

- `[x]` сделано
- `[-]` в работе / начато
- `[ ]` ещё не сделано

## Sprint 1: стабильность и защита от регрессий

- [x] Починить lifecycle мокап-сессий и не допускать утечки `highQualityMode` между `from-file` и `live`.
- [x] Разделить `live recording` и `manual grab/flush` на разные recorder-ы.
- [x] Добавить regression-набор для типовых проблемных поз.
- [x] Добавить `dispose()/cleanup` для глобальных listeners и runtime-объектов.

## Sprint 2: поддерживаемость solver-а

- [x] Разбить `src/mocap/directPoseApplier.ts` на torso / arms / legs / hands / diagnostics.
- [x] Ввести единый типизированный объект diagnostics для solver-а.
- [x] Улучшить экспорт BVH: реальные offsets, root motion, более честный внешний формат.

## Sprint 3: архитектура UI и bootstrap

- [x] Разбить `src/debugPanel.ts` на несколько модулей.
- [x] Упростить bootstrap и wiring в `src/main.ts`.
- [x] Добавить более явные границы между playback, mocap и debug-инструментами.

## Later

- [x] Оптимизировать bundle и подумать про lazy-load debug/tooling частей.
- [x] Оптимизировать `AnimationController`, чтобы не держать активными все `AnimationAction`.
- [x] Добавить больше автоматических сценариев проверки ретаргета BVH -> VRM.

## PrimeVue migration TODO

- [-] Завершить перенос нативных контролов внутри Vue-компонентов на PrimeVue:
  `SkeletonSection.vue`, `ValidationFoldContent.vue`, `HipForcePanel.vue`,
  `MocapStatsPanel.vue`, `DebugRecorderRow.vue`, `BvhVerifyFold.vue` и оставшиеся
  кнопки в `DebugPanelRoot.vue`.
- [ ] Убрать DOM-мосты для модалок: заменить `querySelector`/id-кнопки
  `#skel-info-btn` и `#bvh-diag-btn` на props/events или общий reactive modal API.
- [ ] Решить, оставлять ли native `<details>/<summary>` для fold-секций или
  переносить их на PrimeVue `Accordion`/`Panel` с сохранением localStorage-state.
- [ ] Почистить старые глобальные CSS-правила под vanilla UI:
  `.dbg-toggle`, `.dbg-tabs`, queue styles и `input[type="range"]`, когда
  соответствующие элементы окончательно уйдут в PrimeVue.
- [ ] Убрать остаточное прямое обновление DOM для статуса в `ui.ts`
  (`document.getElementById('status')`) и оставить только реактивный `statusText`.
- [ ] После каждого крупного UI-пакета прогонять `npm run build` и быстрый
  Playwright screenshot для правой панели, main/video tab и modal flows.

## Что уже сделано в этом проходе

- [x] Lifecycle file-mode стал безопаснее: solver теперь гарантированно выходит из `highQualityMode` даже при прерывании или ошибке.
- [x] `grab/flush` отделены от основной live-записи BVH.
- [x] Добавлен первый слой regression-набора: fixture-тесты для ключевых solver-эвристик (`torso lateral gain`, `arm scale cap`, `midpoint`, `hands-together`, `prayer`, `face-near`).
- [x] Добавлен cleanup-контур для `scene`, render loop, transport, debug panel и mocap runtime, чтобы listeners и интервалы не залипали между mount-ами.
- [x] Solver diagnostics вынесены в отдельный модуль и стали общим типизированным контрактом для `DirectPoseApplier`, debug panel, debug recorder и debug viz.
- [x] Из `DirectPoseApplier` вынесены отдельные модули для landmarks/config, hand-retarget, torso-math, arm-target solve и leg-target/foot-lock solve; дальше можно безопаснее разносить оставшийся torso / bone-application orchestration по файлам.
- [x] Базовые преобразования MediaPipe -> VRM сведены в общий `motionSpace`-модуль, чтобы arms / hands / legs / torso не расходились по знакам и depth-scale.
- [x] Для `arms` и `legs` вынесен общий two-bone IK apply-слой, так что `DirectPoseApplier` больше не дублирует world->local solve для двухзвенных цепей.
- [x] Обычный one-bone direction retarget и clavicle/shoulder solve тоже вынесены в отдельные модули, так что в `DirectPoseApplier` осталось меньше низкоуровневой математики и больше orchestration.
- [x] Для BVH export убраны нулевые joint offsets и заглушка root-position: recorder теперь пишет реальные normalized-bone offsets и текущую позицию `hips`.
- [x] `src/debugPanel.ts` (2026 строк) разбит на три модуля: `debugPanelHtml.ts` — HTML-шаблоны (286 строк), `debugPanelSkelModal.ts` — skeleton info modal (962 строки), `debugPanel.ts` — orchestration + wiring (835 строк).
- [x] `src/main.ts` упрощён до чистой orchestration (~200 строк): вынесены `startRenderLoop` → `renderLoop.ts`, `mountTransport` → `transport.ts`, `MOCAP_VALIDATION_EXCLUDED_BONES` → `mocap/mocapValidationBones.ts`.
- [x] Введены явные типизированные группы `PlaybackSystems`, `MocapSystems`, `ToolingSystems` в `src/playerSystems.ts`; сигнатуры `startRenderLoop` и `mountDebugPanel` сокращены с 12/10 позиционных параметров до 4–5 семантических групп.
- [x] `AnimationController`: убран `play()` при регистрации — миксер тикает только 1–2 активных action вместо всей библиотеки; `stop()` вызывается после завершения crossfade и при `setMuted`.
- [x] Vite `manualChunks`: `vendor` (three.js + three-vrm) и `debug` (debugPanel + tooling) чанки для правильного HTTP-кэширования; true lazy-load отложен до рефактора render loop.
- [x] `tests/regression/clipValidator.test.mjs`: 15 новых тестов для `clipValidator` + `boneConstraints` — детектирование нарушений ROM, кламп, симметрия L/R, worst-bone reporting, неизвестные bones; итого 28 тестов (было 13).
