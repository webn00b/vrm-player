# Пайплайн мокап → скелет

Цикл в [main.ts:184-249](../src/main.ts#L184-L249) каждый кадр идёт по слоям, где каждый следующий пишет поверх предыдущего.

## 1. Захват позы

[PoseDetector](../src/mocap/poseDetector.ts) гоняет MediaPipe BlazePose по `<video>` (веб-камера или файл) и в колбэке `onFrame` выдаёт `PoseFrame` с world-landmarks, видимостью и landmarks рук ([mocapController.ts:48-56](../src/mocap/mocapController.ts#L48-L56)). Контроллер только сохраняет кадр в `_latestFrame` — применение отложено до рендер-тика.

## 2. Калибровка

`MocapCalibration.feed()` копит T-pose сэмплы (когда руки раскрыты) и считает длины костей перформера и avatar-масштабы (`armScale`, `legScale`, `bodyScale`).

## 3. Порядок в tick'е

Важен, потому что всё пишет в одни и те же кости:

1. `controller.update(delta)` — three.js `AnimationMixer` проигрывает BVH-клип из очереди ([animationController.ts:46-58](../src/animationController.ts#L46-L58)).
2. `idleLoop` + приоритетный аниматор — только если BVH замьючен.
3. `validator.clampAll()` — клампит кости по ROM.
4. **`mocap.applyLatestFrame()`** — поверх анимации пишет mocap-позу ([mocapController.ts:121-131](../src/mocap/mocapController.ts#L121-L131)).
5. `bonePanel.apply()` — ручные оффсеты поверх всего.
6. `vrm.update()` — spring bones, blendshapes.

## 4. Как `DirectPoseApplier.apply()` превращает landmarks в повороты костей

Вход: [directPoseApplier.ts:259-290](../src/mocap/directPoseApplier.ts#L259-L290).

### 4.1 Hips

Строится ортонормальный базис торса (`hipAxis × spineDir → Z`), получается world-кватернион, домножается на `_hipsBaseWorld` (чтобы T-pose = естественное направление модели), переводится в parent-local и slerp'ится ([L376-L458](../src/mocap/directPoseApplier.ts#L376-L458)). Позиция хипа — дельта центра таза перформера × `bodyScale`.

### 4.2 Spine / chest twist

Yaw между линией плеч и линией бёдер, проецированный на XZ в локали хипов, делится поровну между spine и chest ([L466-L513](../src/mocap/directPoseApplier.ts#L466-L513)).

### 4.3 Руки/ноги через two-bone IK

Если откалибровано:

- **якорь** — мировая позиция плеча/бедра аватара;
- **target** = anchor + масштабированный вектор (wrist − shoulder) перформера;
- **pole** = направление к локтю/колену (EMA-сглаженное, чтобы не флипало сустав).

`solveTwoBoneIK` возвращает world-направления upper/lower, которые переводятся в parent-local через `setFromUnitVectors(restAxis, dirLocal)` ([L563-L698](../src/mocap/directPoseApplier.ts#L563-L698)).

Если калибровки нет — fallback на `_applyLimb` (простой parent→child вектор).

### 4.4 Пальцы

`KalidoHand.solve` по landmarks рук — MediaPipe body даёт только wrist.

### 4.5 Лицо

`FaceApplier` пишет blendshapes (не конфликтует с костями).

## 5. Сглаживание

У всех поворотов `slerp(target, lerp)`, раздельные коэффициенты:

- `_spineLerp = 0.25` — стабильный торс;
- `_bodyLerp = 0.7` — отзывчивые конечности.

В HQ-режиме (запись из файла) `lerp = 1` — снап, чтобы BVH точно повторял видео.

## 6. Зеркалирование

Landmarks перформера-справа подаются в `left*` кости VRM + `_mirrorX` флипает X; в T-pose это даёт identity, в движении — естественное селфи-отражение ([L20-L33](../src/mocap/directPoseApplier.ts#L20-L33)).

## 7. Запись BVH

После каждого `apply()` в состоянии `recording` вызывается `recorder.addFrame((name) => applier.getQuaternion(name))`, который читает `node.quaternion` уже посчитанных костей ([mocapController.ts:127-130](../src/mocap/mocapController.ts#L127-L130)).

На стопе — `BvhRecorder.stop()` собирает текст и отдаёт через `onBvhReady` (в [main.ts:147](../src/main.ts#L147) это регистрируется как новый клип в `AnimationController` — замыкая петлю).
