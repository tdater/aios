// Disposal bookkeeping: everything the renderer creates is tracked here and released in one call on unmount.
export interface Disposable { dispose(): void }

interface Traversable { traverse?(fn: (o: unknown) => void): void }
interface MeshLike { geometry?: unknown; material?: unknown }

const isDisposable = (x: unknown): x is Disposable => !!x && typeof (x as Disposable).dispose === "function";
const isTexture = (x: unknown) => !!x && (x as { isTexture?: boolean }).isTexture === true;

export class ResourceTracker {
  private items = new Set<Disposable>();

  get size(): number { return this.items.size; }

  /** Track a geometry, material, texture, render target, or a whole object tree (its geometries, materials and textures). */
  track<T>(thing: T): T {
    if (!thing) return thing;
    const tree = thing as unknown as Traversable;
    if (typeof tree.traverse === "function") {
      tree.traverse((o) => {
        const mesh = o as MeshLike;
        if (isDisposable(mesh.geometry)) this.items.add(mesh.geometry);
        const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        for (const mat of mats) this.trackMaterial(mat);
      });
      return thing;
    }
    if ((thing as { isMaterial?: boolean }).isMaterial) { this.trackMaterial(thing); return thing; }
    if (isDisposable(thing)) this.items.add(thing);
    return thing;
  }

  private trackMaterial(mat: unknown) {
    if (!isDisposable(mat)) return;
    this.items.add(mat);
    for (const v of Object.values(mat as unknown as Record<string, unknown>)) if (isTexture(v) && isDisposable(v)) this.items.add(v);
    const uniforms = (mat as { uniforms?: Record<string, { value: unknown }> }).uniforms;
    if (uniforms) for (const u of Object.values(uniforms)) if (u && isTexture(u.value) && isDisposable(u.value)) this.items.add(u.value);
  }

  /** Dispose everything tracked; returns how many resources were released. */
  dispose(): number {
    let n = 0;
    for (const it of this.items) { try { it.dispose(); n++; } catch { /* already gone with the context */ } }
    this.items.clear();
    return n;
  }
}
