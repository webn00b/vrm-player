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

- [ ] Разбить `src/mocap/directPoseApplier.ts` на torso / arms / legs / hands / diagnostics.
- [x] Ввести единый типизированный объект diagnostics для solver-а.
- [ ] Улучшить экспорт BVH: реальные offsets, root motion, более честный внешний формат.

## Sprint 3: архитектура UI и bootstrap

- [ ] Разбить `src/debugPanel.ts` на несколько модулей.
- [ ] Упростить bootstrap и wiring в `src/main.ts`.
- [ ] Добавить более явные границы между playback, mocap и debug-инструментами.

## Later

- [ ] Оптимизировать bundle и подумать про lazy-load debug/tooling частей.
- [ ] Оптимизировать `AnimationController`, чтобы не держать активными все `AnimationAction`.
- [ ] Добавить больше автоматических сценариев проверки ретаргета BVH -> VRM.

## Что уже сделано в этом проходе

- [x] Lifecycle file-mode стал безопаснее: solver теперь гарантированно выходит из `highQualityMode` даже при прерывании или ошибке.
- [x] `grab/flush` отделены от основной live-записи BVH.
- [x] Добавлен первый слой regression-набора: fixture-тесты для ключевых solver-эвристик (`torso lateral gain`, `arm scale cap`, `midpoint`, `hands-together`, `prayer`, `face-near`).
- [x] Добавлен cleanup-контур для `scene`, render loop, transport, debug panel и mocap runtime, чтобы listeners и интервалы не залипали между mount-ами.
- [x] Solver diagnostics вынесены в отдельный модуль и стали общим типизированным контрактом для `DirectPoseApplier`, debug panel, debug recorder и debug viz.
