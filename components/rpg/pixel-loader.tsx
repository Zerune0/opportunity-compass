import styles from "./pixel-loader.module.css";

const PIXELS = Array.from({ length: 8 }, (_, index) => index);

export function PixelLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div className={styles.loader} role="status" aria-live="polite" aria-atomic="true">
      <div className={styles.orbit} aria-hidden="true">
        {PIXELS.map((index) => (
          <span
            className={styles.arm}
            key={index}
            style={{ transform: `rotate(${index * 45}deg)` }}
          >
            <span
              className={styles.pixel}
              style={{ animationDelay: `${-index * 0.2}s` }}
            />
          </span>
        ))}
      </div>
      <p className={styles.label}>{label}</p>
    </div>
  );
}
