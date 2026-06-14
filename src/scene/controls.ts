import * as THREE from "three";

/**
 * 天球の中心から空を見回すカメラコントローラ。
 * パン方式: ドラッグで空を掴んで引っ張るような操作感。
 * フライト中は enabled=false にして外部からカメラを動かす。
 */
export class SkyControls {
  enabled = true;

  private yaw = 0;
  private pitch = 0.15;
  private targetYaw = 0;
  private targetPitch = 0.15;
  private velYaw = 0;
  private velPitch = 0;

  private fov: number;
  private targetFov: number;

  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  /** 直近のドラッグ移動量（クリックとの区別用） */
  dragDistance = 0;

  private lookAnim: {
    fromYaw: number;
    fromPitch: number;
    toYaw: number;
    toPitch: number;
    t: number;
    duration: number;
  } | null = null;

  constructor(
    private camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
  ) {
    this.fov = camera.fov;
    this.targetFov = camera.fov;

    dom.addEventListener("pointerdown", (e) => {
      if (!this.enabled) return;
      this.dragging = true;
      this.dragDistance = 0;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.lookAnim = null;
      this.velYaw = 0;
      this.velPitch = 0;
      dom.setPointerCapture(e.pointerId);
    });

    dom.addEventListener("pointermove", (e) => {
      if (!this.dragging || !this.enabled) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.dragDistance += Math.abs(dx) + Math.abs(dy);
      // パン方式: ドラッグ右→空が右へ、ドラッグ下→空が下へ（どちらも引っ張る感覚）
      const k = (this.fov / 55) * 0.0024;
      this.targetYaw += dx * k;
      this.targetPitch += dy * k;
      this.velYaw = dx * k;
      this.velPitch = dy * k;
      this.clampPitch();
    });

    const end = () => {
      if (this.dragging) {
        // 慣性: 離した瞬間の速度を引き継ぐ
        this.targetYaw += this.velYaw * 10;
        this.targetPitch += this.velPitch * 10;
        this.clampPitch();
      }
      this.dragging = false;
    };
    dom.addEventListener("pointerup", end);
    dom.addEventListener("pointercancel", end);

    dom.addEventListener(
      "wheel",
      (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        this.targetFov = THREE.MathUtils.clamp(
          this.targetFov * Math.pow(1.1, e.deltaY > 0 ? 1 : -1),
          20,
          80,
        );
      },
      { passive: false },
    );
  }

  private clampPitch() {
    const lim = Math.PI / 2 - 0.02;
    this.targetPitch = THREE.MathUtils.clamp(this.targetPitch, -lim, lim);
  }

  /** フライト復帰など外部から呼ぶ: 内部状態をリセット */
  reset() {
    this.dragging = false;
    this.velYaw = 0;
    this.velPitch = 0;
    this.lookAnim = null;
    this.dragDistance = 0;
  }

  /** 指定方向へ滑らかに視線を向ける */
  lookTowards(dir: THREE.Vector3, duration = 1.6) {
    const toPitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
    let toYaw = Math.atan2(-dir.x, -dir.z);
    const twoPi = Math.PI * 2;
    while (toYaw - this.yaw > Math.PI) toYaw -= twoPi;
    while (toYaw - this.yaw < -Math.PI) toYaw += twoPi;
    this.lookAnim = {
      fromYaw: this.yaw,
      fromPitch: this.pitch,
      toYaw,
      toPitch,
      t: 0,
      duration,
    };
  }

  /** 現在の視線方向（単位ベクトル） */
  getDirection(out = new THREE.Vector3()): THREE.Vector3 {
    const cp = Math.cos(this.pitch);
    out.set(
      -Math.sin(this.yaw) * cp,
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * cp,
    );
    return out;
  }

  update(dt: number) {
    if (this.lookAnim) {
      const a = this.lookAnim;
      a.t += dt;
      const u = Math.min(a.t / a.duration, 1);
      const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      this.yaw = a.fromYaw + (a.toYaw - a.fromYaw) * e;
      this.pitch = a.fromPitch + (a.toPitch - a.fromPitch) * e;
      this.targetYaw = this.yaw;
      this.targetPitch = this.pitch;
      if (u >= 1) this.lookAnim = null;
    } else {
      const damp = 1 - Math.exp(-dt * 8);
      this.yaw += (this.targetYaw - this.yaw) * damp;
      this.pitch += (this.targetPitch - this.pitch) * damp;
    }

    this.fov += (this.targetFov - this.fov) * (1 - Math.exp(-dt * 8));
    if (this.enabled) {
      if (Math.abs(this.camera.fov - this.fov) > 0.01) {
        this.camera.fov = this.fov;
        this.camera.updateProjectionMatrix();
      }
      const dir = this.getDirection();
      this.camera.lookAt(
        this.camera.position.x + dir.x,
        this.camera.position.y + dir.y,
        this.camera.position.z + dir.z,
      );
    }
  }

  /** フライト復帰時: 同フレーム内でカメラをすぐ更新する（update()が既に走り済みのフレーム用） */
  forceUpdate() {
    const dir = this.getDirection();
    this.camera.lookAt(
      this.camera.position.x + dir.x,
      this.camera.position.y + dir.y,
      this.camera.position.z + dir.z,
    );
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }

  /** フライト復帰時: カメラの向きに合わせて内部状態を同期 */
  syncFromCamera() {
    this.reset();
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    this.pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.targetYaw = this.yaw;
    this.targetPitch = this.pitch;
    this.fov = this.camera.fov;
    this.targetFov = this.camera.fov;
  }
}
