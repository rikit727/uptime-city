/**
 * Unit geometries for building parts. Each has its base at y = 0 and spans
 * -0.5..0.5 in x and z (or as noted), so an instance matrix scales it to
 * (w, h, d) and moves it into place.
 */
import { BoxGeometry, BufferGeometry, CylinderGeometry, Float32BufferAttribute } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export function unitBox(): BufferGeometry {
  return new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
}

/** A gable roof: ridge along x at the top, slopes facing ±z. */
export function unitGable(): BufferGeometry {
  const a = [-0.5, 0, -0.5];
  const b = [0.5, 0, -0.5];
  const c = [0.5, 0, 0.5];
  const d = [-0.5, 0, 0.5];
  const e = [-0.5, 1, 0];
  const f = [0.5, 1, 0];
  const tris = [
    [a, e, f],
    [a, f, b], // north slope
    [d, c, f],
    [d, f, e], // south slope
    [a, d, e], // west gable
    [b, f, c], // east gable
  ];
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(tris.flat(2), 3));
  g.computeVertexNormals();
  return g;
}

export function unitCylinder(): BufferGeometry {
  return new CylinderGeometry(0.5, 0.5, 1, 10).translate(0, 0.5, 0);
}

/** Half cylinder lying along x with the curve on top (polytunnel): y 0..1, z -1..1. */
export function unitTunnel(): BufferGeometry {
  return new CylinderGeometry(1, 1, 1, 12, 1, true, -Math.PI / 2, Math.PI)
    .rotateZ(Math.PI / 2)
    .rotateX(-Math.PI / 2)
    .scale(1, 1, 0.5);
}

/** Three blades in the x–y plane around the origin, radius 0.5. */
export function unitRotor(): BufferGeometry {
  const blades = [0, 1, 2].map((k) =>
    new BoxGeometry(0.06, 0.5, 0.02).translate(0, 0.25, 0).rotateZ((k * 2 * Math.PI) / 3),
  );
  return mergeGeometries(blades)!;
}
