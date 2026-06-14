# Размеры человека и пайплайн «видео → анимация»

Документ про две вещи:

1. как из видео получается анимация на VRM-модели;
2. как измеряется размер человека на видео и зачем.

Сначала — простыми словами и коротко. Потом — технические детали с файлами и формулами.

Связанные документы: [mocap-pipeline.md](./mocap-pipeline.md) (слои ретаргета подробно), [architecture.md](./architecture.md), [offline-mocap-import.md](./offline-mocap-import.md).

---

## Часть 1. Простыми словами

### Что вообще происходит

На входе — видео с человеком. На выходе — BVH-анимация, которая проигрывается на 3D-модели (VRM).

Идём так:

1. **Смотрим видео и находим точки тела** (плечи, локти, бёдра, колени и т.д.) — это делает MediaPipe.
2. **Достраиваем глубину** (3D), потому что с одной камеры глубина угадывается плохо. Это делает нейросеть MotionBERT.
3. **Измеряем размер человека** — один раз по всему видео (длина рук, ног, ширина бёдер/плеч).
4. **Переносим позу на модель** и записываем в BVH.

### Зачем измерять размер

Человек на видео и 3D-модель почти всегда разного телосложения: разный рост, длина рук, ширина плеч. Плюс человек то ближе, то дальше от камеры.

Чтобы модель не выглядела криво, нужно знать пропорции человека и согласовать их с пропорциями модели.

### Главная идея: углы, а не точки

Раньше руку/ногу ставили «по точке»: тянули кисть модели туда, где кисть человека. Это требовало точного множителя размера, и он гулял от видео к видео — одно движение ложилось по-разному.

Сейчас конечности ставятся **по направлению кости**: куда смотрит «плечо → локоть», куда «локоть → запястье». Направление — это просто угол, оно не зависит от роста человека и расстояния до камеры. Поэтому одно и то же движение с любого видео даёт **одинаковые углы** на модели. Модель держит свои длины костей и перенимает только углы — ровно так анимация ложится на любой скелет.

Размер всё ещё нужен, но только для **позиции** (куда сместить всё тело по сцене, на какой высоте таз), не для углов.

### Почему размер считаем один раз

Это офлайн-обработка: видео уже всё перед нами. Поэтому размер меряем **один раз по всему клипу** (берём медиану по всем кадрам), а не подгоняем на лету. Так нет кривого старта (первые кадры) и нет дрожания размера в середине.

### Что с контактом (руки вместе, стопы на полу)

Углы хорошо ставят позу, но кисть может не попасть в точную точку. Для случаев «руки сомкнулись» / «стопа на полу» есть отдельная доводка (контактный IK), которая дотягивает. На практике для рук чистые углы и так держат ладони близко, поэтому доводка по умолчанию выключена; стопы держит привязка таза к высоте прямых ног.

---

## Часть 2. Технические детали

### 2.1. Два прохода (offline two-pass)

Файл: `src/mocap/pipeline/mocapController.ts` (`startFileCapture`).

```text
Pass A  — детект + (опц.) 3D-лифт всего клипа
  ↓
де-биас торса и ног (артефакт лифтера)
  ↓
offline-сглаживание landmarks (zero-phase)
  ↓
КАЛИБРОВКА РАЗМЕРА 1 РАЗ по всему клипу        ← медиана, не EMA
  ↓
Pass B  — ретаргет каждого кадра + запись BVH
```

- **Pass A** — `PoseDetector` гоняет MediaPipe Holistic по кадрам, собирает `landmarks` (нормализованные, image-space) + `worldLandmarks` (метры, hip-centered). См. `src/mocap/pipeline/poseDetector.ts`.
- **3D-лифт** — `MotionBertLifter.liftSequence` (`src/mocap/pipeline/poseLifter.ts`): MotionBERT ONNX, окна по 243 кадра, заменяет world-позиции 12 конечностных суставов на temporally-lifted 3D. Запускается только при полном покрытии тела (`coverage >= FULL_BODY_COVERAGE_MIN`).
- **Де-биас** — `debiasTorsoLean` + `debiasLegLean` (`src/mocap/pipeline/torsoDebias.ts`): лифтер кладёт плечи ~12° и лодыжки ~16° за бёдра даже при прямой стойке; убираем медианный наклон, поворачивая верх/низ тела вокруг hip-центра.
- **Сглаживание** — `smoothMocapFrames` (`src/mocap/pipeline/offlineLandmarkSmoother.ts`), zero-phase (median-3 + Butterworth).
- **Pass B** — каждый сглаженный кадр прогоняется через `DirectPoseApplier.applyDirect` и пишется в `MocapBvhSession` → BVH.

### 2.2. Размеры аватара (один раз при загрузке)

Файл: `src/avatarMetrics.ts` (`measureAvatarMetrics`), кэш per-VRM. Меряется на нормализованном скелете в rest-позе:

- **длина кости** = длина локального rest-offset дочерней кости: `boneLen('leftLowerArm') = node.position.length()`;
- **ширина** = мировое расстояние между началами костей: `hipWidth = dist(leftUpperLeg, rightUpperLeg)`, `shoulderWidth = dist(leftUpperArm, rightUpperArm)`;
- **headWidth** = `eyeDistance × 1.8` (фоллбэк `headBone × 1.5`);
- **hipsHeight** = `restPose.hips.position.y`.

Эти числа — знаменатель аватара во всех масштабах.

### 2.3. Размеры человека (offline, медиана по клипу)

Файл: `src/mocap/trackers/mocapCalibration.ts`, метод `calibrateFromClip(frames)`.

Идём по всем валидным кадрам, собираем per-frame измерения в массивы, берём **медиану** (для «дотянутости» руки — максимум), затем фиксируем поля и ставим `_locked = true` (после этого `feed()` — no-op, чтобы pass B не «передвинул» размер):

| метрика | формула per-frame | агрегат |
|---|---|---|
| `performerHipWidth` | `dist(hipL, hipR)` | median |
| `performerShoulderWidth` | `dist(shL, shR)` | median |
| `performerHeadWidth` | `dist(earL, earR)` | median |
| `performerLegLen` | `max(dist(hipL,ankL), dist(hipR,ankR))` | median |
| `performer{Left,Right}LegChain` | `dist(hip,knee)+dist(knee,ank)` | median |
| `performer{Left,Right}ArmChain` | `dist(sh,elb)+dist(elb,wr)` | median |
| `performer{Left,Right}ArmMax` | `dist(sh,wr)` (дотянутость) | **max** |
| `_metersPerNormEma` | `worldHipWidthXY / normHipWidthXY` | median |

Все измерения — на `worldLandmarks` (метры). Гейты видимости: `WRIST_VIS_GATE = 0.4` для верха/рук, `_hipVisGate` для бёдер/ног.

Старый путь (live EMA в `feed()`, `EMA_ALPHA = 0.15`) остаётся для камеры в реальном времени; офлайн-путь его перекрывает и лочит.

### 2.4. Масштабы (производные)

| масштаб | формула | где применяется |
|---|---|---|
| `bodyScale()` | `avatarWidth / performerWidth` (hip/shoulder/head, по `_scaleRef`, рекоменд. median) | ширина рук, fallback |
| `legScale()` | `avatarLegLen / performerLegChain` | **только трансляция корня** (углы ног — по направлению) |
| `armScale(side)` | `avatarArmLen / performerArmChain` | трансляция запястья в IK-режиме / fallback |
| `metersPerNorm()` | медиана `worldHipXY / normHipXY` | перевод image-space сдвига таза в метры |

Важно: после перехода на direction-ретаргет (см. 2.5) масштаб **не влияет на углы локтя/колена** — только на позиции (корень, контактная доводка).

### 2.5. Ретаргет позы (Pass B)

Файл: `src/mocap/retargeters/directPoseApplier.ts` (`applyDirect`). Порядок: торс → конечности → кисти.

**Торс** (`TorsoApplier`, `src/mocap/retargeters/torsoApplier.ts`) — вращения из ориентации torso-четырёхугольника (плечи + бёдра); см. `solveHipsOrientationTarget`, `solveSpineTarget`. Кости торса по длине не масштабируются. Защиты: кламп/rate-limit twist'а, anti-parallel atan2-yaw, frontal deadband, hips-yaw guard.

**Конечности — direction-ретаргет (length-invariant), по умолчанию:**

- `settings.legDirectionRetarget = true`, `settings.armDirectionRetarget = true`.
- Каждая кость выравнивается на направление landmark'а через `applyWorldDirectionToBone` (`src/mocap/retargeters/boneDirectionRetarget.ts`): `q = setFromUnitVectors(restAxis, dirInParentFrame)`.
  - upperArm ← `shoulder→elbow`, lowerArm ← `elbow→wrist`;
  - upperLeg ← `hip→knee`, lowerLeg ← `knee→ankle`.
- Направление — единичный вектор → угол сустава **не зависит от размера/дистанции**. `legScale`/`armScale` в угол не входят.
- Старый scaled-position-IK (`ArmIKApplier`/`LegIKApplier` + `twoBoneIK.ts`, закон косинусов) остаётся за флагами (`armDirectionRetarget = false` / `legDirectionRetarget = false`).

**Контактная доводка (опц., `armContactFixup`, по умолчанию off):** при сведённых запястьях (`_wristsClose`: `wristGap < 0.6 × shoulderSpan`) кадр уходит на позиционный IK, чтобы запястья встретились. Замерено: на сведённых руках чистые направления и так держат зазор ~3 см, а IK на untrusted-видео расширяет до ~6 см, поэтому off; хук оставлен для будущего midpoint-nudge.

**Кисти/пальцы** — `applyKalidoHandRetarget` поверх (`src/mocap/retargeters/handRetarget.ts`).

### 2.6. Позиция и заземление таза

Файл: `torsoApplier.ts` (`applyHips`) + `solveHipPositionTarget` (`src/mocap/solvers/torsoTargetSolver.ts`).

- **Горизонталь** — дельта нормализованного центра бёдер × `legScale × metersPerNorm` (image-space; глубина пока не восстанавливается, normalized z ≈ 0).
- **Вертикаль** — `absoluteHeight.worldY`:
  - стоя (standing-латч): `_standHipWorldY` = собственная прямо-ногая высота аватара (rest hips Y × `STAND_STRAIGHT_RATIO 0.997`) — не зависит от пропорций человека, убирает «вечный присед»;
  - не стоя: `groundWorldY + hipHeightM × legScale` (метрический присед).
- **Анти-bob**: липкий exit латча (`STAND_EXIT_RATIO 0.88`) + rate-limit вертикали таза (`HIP_Y_MAX_STEP 1.2 см/тик`) — иначе латч снапит таз ~7 см при подъёме руки (читается как тряска камеры).
- **Стопы** — при direction-ногах заземление держит standing-пин + foot-lock; ground-clamp в `legTargetSolver.ts` (для IK-режима).

### 2.7. Выход BVH

Файлы: `src/mocap/bvh/bvhRecorder.ts`, `bvhRecorderFactory.ts`.

- HIERARCHY `OFFSET` = собственные длины костей **аватара** (`getJointOffset` из rest-позы).
- MOTION = трансляция корня (`hipsPos`) + углы суставов (ZYX Euler, с unwrap для непрерывности).
- Per-frame длины костей не пишутся.

Вывод: BVH несёт скелет аватара; данные движения — это вращения + трансляция корня. Поэтому корректные **углы** (direction-ретаргет) ложатся на модель консистентно с любого видео.

### 2.8. Где смотреть, если поза кривая

- `[animation:quality] roughness=… hipsPos=…` — гладкость записи.
- `[mocap:two-pass] offline calibration: bodyScale=… legScale=…` — итоговый размер клипа.
- `[mocap:two-pass] torso/leg de-bias …deg` — снятый наклон лифтера.
- Инструмент `tools/skeleton-overlay.mjs` — наложение video-pose (зелёный) и avatar-скелета (красный) для поиска ошибок направления.
