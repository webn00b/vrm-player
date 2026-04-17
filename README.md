# VRM BVH Player

Плеер BVH-анимаций для VRM-моделей на three.js + `@pixiv/three-vrm`. Все BVH-файлы из папки `animations/` проигрываются по кругу с плавными кроссфейдами.

## Быстрый старт

```bash
npm install
npm run dev
```

Откроется `http://127.0.0.1:5173`.

## Ассеты

### VRM-модель

Бросьте `.vrm`-файл в папку `models/` в корне проекта. Имя любое — берётся первый по алфавиту. Источники (CC0):

- https://vroid.pixiv.help/hc/en-us/articles/4402394424089 (`AvatarSample_A` ... `_G`)
- https://github.com/vrm-c/vrm-specification/tree/master/samples

### BVH-анимации

Просто кладите `.bvh`-файлы в **папку `animations/`** в корне проекта. Vite при старте сам их подберёт — никакого конфига и перезагрузки.

**Порядок воспроизведения** — алфавитный по имени файла. Хочется конкретный порядок — используйте префиксы:

```
animations/
├── 01-idle.bvh
├── 02-walk.bvh
├── 03-wave.bvh
└── 04-sit.bvh
```

Дойдя до последней, плеер начинает с первой. Кликните по пункту в правой панели, чтобы сразу переключиться.

#### Как получить BVH из Mixamo

1. https://www.mixamo.com → выбрать `Y Bot` (или любого с `mixamorig` скелетом).
2. Выбрать анимацию → **Download** → **FBX Binary (.fbx)**, **Without Skin**, `30 fps`.
3. В Blender: `File → Import → FBX`.
4. `File → Export → Motion Capture (.bvh)` → настройки: `Rotation: Native`, `Root Transform Only: выкл`.
5. Сохранить в `animations/` c нужным префиксом.

## Архитектура

- `src/scene.ts` — three.js сцена, OrbitControls, свет, grid.
- `src/vrmLoader.ts` — загрузка VRM через `GLTFLoader` + `VRMLoaderPlugin`.
- `src/bvhLoader.ts` — парсинг BVH.
- `src/skeletonMap.ts` — **структурное авто-определение** humanoid-костей BVH-скелета (по иерархии и длинам, адаптировано из [pixiv/bvh2vrma](https://github.com/pixiv/bvh2vrma)). Работает с любым биped-скелетом независимо от имён (Mixamo, MMD, кастомные).
- `src/retarget.ts` — использует `skeletonMap` и переписывает треки BVH-клипа в имена нормализованного VRM humanoid; auto-scale + anchor hips к rest-позе.
- `src/animationController.ts` — `AnimationMixer` + последовательное воспроизведение с `crossFadeTo` (0.4 сек).
- `src/ui.ts` — панель со списком, подсветка активного.
- `src/main.ts` — `import.meta.glob('/models/*.vrm')`, `import.meta.glob('/animations/*.bvh')`, склейка всего.

## Известные ограничения

- **A-pose vs T-pose**: если rest-поза BVH-рига — A-pose, а у VRM — T-pose, ретаргет разницу не компенсирует, руки смотрятся слегка опущенными. Фикс: в Blender применить `Apply Pose as Rest Pose` на риг до экспорта BVH, либо добавить per-bone rest-offset в `retarget.ts`.
- Пальцы не ретаргетятся (`skeletonMap` определяет их, но `retarget` их пропускает).
- Кроссфейд жёстко 0.4 сек.
