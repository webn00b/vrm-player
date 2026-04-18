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

## Mocap-калибровка и IK на руках

Чистый angle-driven ретаргет (см. `directPoseApplier.ts`) копирует углы поворотов с landmark'ов MediaPipe на кости VRM. Если пропорции перформера отличаются от аватара (шире плечи, длиннее предплечье), углы совпадут, а вот **мировые позиции кистей не совпадут** — в кадре руки перформера касаются, у аватара промах.

Фикс — two-bone IK на плечо+локоть с авто-калибровкой масштаба.

### Как работает

**Калибровка** (`src/mocap/mocapCalibration.ts`):

- Один раз на конструкторе читает длины костей VRM из rest-позы (`leftUpperArm`, `leftLowerArm`, `rightUpperArm`, `rightLowerArm`, ширина плеч).
- Каждый кадр mocap'а кормится в `calibration.feed(frame)`. Кадр принимается только если `visibility ≥ 0.9` на всех шести ключевых точках (плечи, локти, запястья).
- После 30 принятых сэмплов берётся **медиана** длин перформера, флаг `calibrated = true` зажигается.
- `armScale(side) = avatarArmLen / performerArmLen` — ratio для соответствующей руки, используется IK'ом.
- `recalibrate()` сбрасывает сэмплы — следующие 30 «хороших» кадров заново обучат.

**IK** (`src/mocap/twoBoneIK.ts`, `solveTwoBoneIK`):

- Закрытая формула по закону косинусов. Вход: shoulder world pos, target hand world pos, pole vector (куда локоть «бугрится»), длины upper/lower. Выход: направления upperDir / lowerDir в мировом frame + elbow pos.
- Unreachable (target дальше чем upper+lower) → цепь вытягивается в прямую линию к цели.
- Degenerate (target совсем близко к shoulder) → fallback на направление pole-вектора.

**Интеграция** (`directPoseApplier._applyArmIK`):

1. Якорь цели — **середина плеч аватара** (midpoint `leftUpperArm.worldPos` + `rightUpperArm.worldPos`), не само плечо. Это критично: когда перформер сводит руки на средней линии тела, scaled offset от midline → 0 → target на midline у аватара; без этого при разнице ширины плеч руки аватара пересекают друг друга.
2. `wristOffset = performerWrist - midPerformerShoulder` (обе точки у перформера) → через `_mpDeltaToVrm` в VRM-frame.
3. Масштабируем **по осям раздельно**: X (поперёк плеч) → `shoulderWidthRatio`, Y (вертикаль) и Z (глубина) → `armScale(side)`. Это сохраняет «руки встречаются на центре» и при этом даёт аватару тянуться на полную его длину руки при вертикальных/фронтальных движениях.
4. `target = midAvatarShoulder + scaledOffset`. Plus `pole = elbow - shoulder` в VRM-frame (только направление, не масштаб).
5. `solveTwoBoneIK(sameSideShoulderWorld, target, pole, upperLen, lowerLen)` — точка поворота IK остаётся в одноимённом плече, чтобы локоть крутился вокруг правильного суставa.
6. Трансформируем world-space `upperDir`/`lowerDir` в parent-local frame каждой кости и пишем через `setFromUnitVectors(restAxis, dirLocal)` — как в обычном angle-based пайплайне.
7. Пока калибровка не готова, фолбек на angle-based `_applyLimb` — mocap не блокируется.

Ноги и торс идут по старому angle-driven пути: на ногах стопы хотят «прилипнуть» к полу, что требует foot-planting IK — другая задача. Кисть (wrist rotation) остаётся за `_applyHand` (KalidoHand из kalidokit).

### Debug-панель

Секция **Mocap** → строка **📏 Calibration**:

- `—` — mocap ещё не запускался.
- `collecting N/30` — набирается буфер «хороших» кадров.
- `✓ arms L 95% R 107%` — готово; проценты = `armScale * 100` (если > 100%, рука аватара длиннее перформера).

Кнопка **Recalibrate** сбрасывает буфер. Используй после смены перформера или когда камера переместилась и угол сильно поменялся.

### Известные ограничения IK

- **Unreachable target в исходных кадрах**: если перформер сильно вытянул руку, scaled target иногда чуть дальше `upperLen + lowerLen` — solver переходит в fully-extended режим, локоть визуально «выпрямляется». На нормальных позах не срабатывает.
- **Depth jitter**: target складывается из всех трёх осей, включая MediaPipe-Z. Если `Depth` в панели стоит на `3D` и Z-landmark'ы нестабильны, target болтается. Переключись на `mid` или `2D` — IK «проецирует» руки на frontal-плоскость.
- **Rest pose аватара**: если VRM экспортирован в A-pose (не T-pose), `restLocalAxis` у `upperArm` окажется не параллельным «вниз», и IK положит руку в ту же сторону, что и rest. Для A-pose-аватаров нужно или переэкспортировать, или ввести per-bone rest-offset (TODO).

## Валидация поворотов костей (ROM)

Модуль `src/validation/` клэмпит повороты гуманоидных костей в анатомически реалистичный диапазон. Нужен, чтобы mocap с плохой видимостью или кривой BVH не выворачивал локти назад и не крутил шею на 270°.

### Источник данных

`src/validation/boneConstraints.ts` — таблица из 55 VRM-гуманоидных костей (`VRMHumanBoneName` из `@pixiv/three-vrm`). Каждая запись — `min/max` по трём осям Эйлера в радианах плюс порядок осей (`XYZ`, `YXZ`, …):

```ts
leftUpperArm: {
  order: 'YXZ',
  min: [d(-80), d(-110), d(-60)],   // flexion / twist / abduction
  max: [d(+110), d(+110), d(+180)],
}
```

Значения взяты из **AAOS Joint Motion** (клинические ROM-таблицы) и **ISB** рекомендаций для сегментов, которых нет в AAOS (пальцы, посегментный позвоночник). Диапазоны сознательно широкие (~110% от медианы ROM), чтобы не резать стилизованные анимации — задача валидатора ловить **явно невозможное**, а не причёсывать под учебник анатомии.

### Как клэмпится

`src/validation/boneValidator.ts` — `clampQuaternion(bone, quat)`:

1. `quat → Euler` с порядком осей из конфига для этой кости.
2. Поэлементный clamp по `min`/`max`.
3. Если что-то вышло за границы — `Euler → quat` обратно, иначе no-op.

Алгоритм без матрицы и SVD, ~20 float-ops на кость, бюджет <0.2 мс на 55 костей.

### Две точки применения

**Runtime (кадр)** — в `src/main.ts`, единый chokepoint между шагом 2 (`pa.applyAll()`) и шагом 3 (`micro.update`):

```
BVH mixer  ──┐
PriorityAnimator (idle) ─┼─▶ validator.clampAll() ─▶ micro-animations ─▶ render
mocap (mediapipe) ──────┘
```

Один вызов покрывает все три источника поворотов; micro-анимации добавляют маленькие дельты **после** clamp, поэтому не борются с валидатором.

**Offline (импорт BVH)** — в `src/retarget.ts`:

```ts
await retargetBvhToVrm(vrm, bvh, name);                         // validate-only
await retargetBvhToVrm(vrm, bvh, name, { clampOutOfRange: true }); // clamp in-place
```

`validateClip(clip, vrm)` / `clampClip(clip, vrm)` из `src/validation/clipValidator.ts` обходят `QuaternionKeyframeTrack`, маппят UUID трека обратно в имя VRM-кости через `humanoid.getNormalizedBoneNode`, применяют тот же clamp к каждому keyframe. По умолчанию `retargetBvhToVrm` только логирует: `[validator] clip "walk": 42 out-of-range keyframes across 12 bones; worst rightUpperArm (+28.3°)`.

### Debug-панель

Секция **Validation (ROM)**:

- **Clamp bone rotations** — toggle ON/OFF валидатора в runtime.
- `clamped/frame: N` — сколько костей прищёлкнуто в последнем кадре.
- `worst: <bone> +X°` — самое большое превышение за кадр.
- **Dump** — выводит текущий конфиг в консоль для тюнинга.

Если конкретная поза в mocap постоянно триггерит одну и ту же кость, открой `boneConstraints.ts`, расширь `min`/`max` у неё и перезагрузи — HMR подхватит без рестарта.

### Per-avatar override

`BoneValidator` вторым аргументом принимает `Partial<Record<VRMHumanBoneName, RotationConstraint>>` — shallow-merge поверх `DEFAULT_BONE_CONSTRAINTS`. Нужно сделать стилизованному персонажу плечо с большей амплитудой — передаёшь только эту запись, остальные берутся по умолчанию.

## Известные ограничения

- **A-pose vs T-pose**: если rest-поза BVH-рига — A-pose, а у VRM — T-pose, ретаргет разницу не компенсирует, руки смотрятся слегка опущенными. Фикс: в Blender применить `Apply Pose as Rest Pose` на риг до экспорта BVH, либо добавить per-bone rest-offset в `retarget.ts`.
- Пальцы не ретаргетятся (`skeletonMap` определяет их, но `retarget` их пропускает).
- Кроссфейд жёстко 0.4 сек.
