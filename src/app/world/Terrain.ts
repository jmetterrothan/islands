import * as THREE from 'three';

import World from '@world/World';
import Chunk from '@world/Chunk';
import BiomeGenerator from '@world/BiomeGenerator';
import Coord from '@world/Coord';
import Biome from '@world/Biome';
import SoundManager from '@shared/SoundManager';

import { crosshairSvc } from '@ui/services/crosshair.service';
import { multiplayerSvc } from '@online/services/multiplayer.service';
import { progressionSvc } from '@achievements/services/progression.service';
import { configSvc } from '@shared/services/config.service';
import { playerSvc } from '@shared/services/player.service';

import { WATER_MATERIAL } from '@materials/water.material';
import { TERRAIN_MATERIAL, TERRAIN_SIDE_MATERIAL } from '@materials/terrain.material';

import { IBiome } from '@world/models/biome.model';
import { IPick } from '@world/models/pick.model';
import { IOnlineObject } from '@online/models/onlineObjects.model';
import { ISpecialObject } from '@world/models/objectParameters.model';
import { ILowHigh, IBiomeWeightedObject } from './models/biomeWeightedObject.model';

import { PROGRESSION_COMMON_STORAGE_KEYS } from '@achievements/constants/progressionCommonStorageKeys.constants';
import { PROGRESSION_ONLINE_STORAGE_KEYS } from '@achievements/constants/progressionOnlineStorageKeys.constants';

import MathUtils from '@shared/utils/Math.utils';
import CommonUtils from '@shared/utils/Common.utils';

import { INTERACTION_TYPE } from '@app/shared/enums/interaction.enum';
import { CROSSHAIR_STATES } from '@ui/enums/CrosshairState.enum';

class Terrain {
  static readonly NCHUNKS_X: number = 12;
  static readonly NCHUNKS_Z: number = 12;
  static readonly NCOLS: number = Terrain.NCHUNKS_X * Chunk.NCOLS;
  static readonly NROWS: number = Terrain.NCHUNKS_Z * Chunk.NROWS;

  static readonly SIZE_X: number = Terrain.NCOLS * Chunk.CELL_SIZE_X;
  static readonly SIZE_Y: number = Chunk.HEIGHT;
  static readonly SIZE_Z: number = Terrain.NROWS * Chunk.CELL_SIZE_Z;

  static readonly CENTER: THREE.Vector2 = new THREE.Vector2(Terrain.SIZE_X / 2, Terrain.SIZE_Z / 2);
  static readonly MIDDLE: THREE.Vector3 = new THREE.Vector3(Terrain.SIZE_X / 2, Terrain.SIZE_Y / 2, Terrain.SIZE_Z / 2);

  static readonly OFFSET_X: number = Terrain.SIZE_X / 2;
  static readonly OFFSET_Z: number = Terrain.SIZE_Z / 2;

  private chunks: Map<string, Chunk>;
  private visibleChunks: Chunk[];

  private start: Coord;
  private end: Coord;
  private chunk: Coord;

  private scene: THREE.Scene;
  private world: World;
  private generator: BiomeGenerator;

  public terrain: THREE.Mesh;
  public terrainSide: THREE.Mesh;
  public water: THREE.Mesh;

  private layers: THREE.Group;
  private specialObjectList: THREE.Object3D[];

  // preview
  private previewItem: IPick;
  private previewObject: THREE.Object3D;
  private currentSubBiome: IBiome;
  private subBiomeOrganisms: IBiomeWeightedObject[];
  private intersectionSurface: THREE.Object3D;
  private objectAnimated: boolean;

  private lastInteractionUpdate: number = 0;

  /**
   * Terrain constructor
   * @param {THREE.Scene} scene
   * @param {World} world
   * @param {BiomeGenerator} generator
   */
  constructor(world: World) {
    this.world = world;
    this.scene = world.getScene();
    this.generator = world.getBiomeGenerator();

    this.chunks = new Map<string, Chunk>();
    this.visibleChunks = [];

    this.layers = new THREE.Group();

    this.chunk = new Coord();
    this.start = new Coord();
    this.end = new Coord();

    this.specialObjectList = [];
  }

  init() {
    this.initMeshes();
    if (multiplayerSvc.isUsed()) this.watchObjectPlaced();
  }

  /**
   * Loads region chunks
   */
  preload() {
    this.loadChunks(0, 0, Terrain.NCHUNKS_Z, Terrain.NCHUNKS_X);

    // borders generation
    const bt1 = this.getBorderMesh(1, Terrain.NCOLS, (row, col) => col * Chunk.CELL_SIZE_X, (row, col) => 0);
    const bt2 = this.getBorderMesh(
      1,
      Terrain.NCOLS,
      (row, col) => col * Chunk.CELL_SIZE_X,
      (row, col) => Terrain.SIZE_Z
    );
    const bt3 = this.getBorderMesh(
      1,
      Terrain.NROWS,
      (row, col) => Terrain.SIZE_X,
      (row, col) => col * Chunk.CELL_SIZE_Z
    );
    const bt4 = this.getBorderMesh(1, Terrain.NROWS, (row, col) => 0, (row, col) => col * Chunk.CELL_SIZE_Z);
    const bt5 = this.getBottomMesh();

    const bw1 = this.getWaterBorderMesh(
      1,
      Terrain.NCHUNKS_X * 4,
      (row, col) => (col * Chunk.WIDTH) / 4,
      (row, col) => Terrain.SIZE_Z,
      false
    );
    const bw2 = this.getWaterBorderMesh(
      1,
      Terrain.NCHUNKS_X * 4,
      (row, col) => (col * Chunk.WIDTH) / 4,
      (row, col) => 0,
      true
    );
    const bw3 = this.getWaterBorderMesh(
      1,
      Terrain.NCHUNKS_Z * 4,
      (row, col) => 0,
      (row, col) => (col * Chunk.WIDTH) / 4,
      false
    );
    const bw4 = this.getWaterBorderMesh(
      1,
      Terrain.NCHUNKS_Z * 4,
      (row, col) => Terrain.SIZE_X,
      (row, col) => (col * Chunk.DEPTH) / 4,
      true
    );

    (<THREE.Geometry>this.terrainSide.geometry).mergeMesh(bt1);
    (<THREE.Geometry>this.terrainSide.geometry).mergeMesh(bt2);
    (<THREE.Geometry>this.terrainSide.geometry).mergeMesh(bt3);
    (<THREE.Geometry>this.terrainSide.geometry).mergeMesh(bt4);
    (<THREE.Geometry>this.terrainSide.geometry).mergeMesh(bt5);

    // water
    const biome: Biome = this.generator.getBiome();
    if (biome.hasWater()) {
      (<THREE.Geometry>this.water.geometry).mergeMesh(bw1);
      (<THREE.Geometry>this.water.geometry).mergeMesh(bw2);
      (<THREE.Geometry>this.water.geometry).mergeMesh(bw3);
      (<THREE.Geometry>this.water.geometry).mergeMesh(bw4);

      // water mesh offset
      const offset = 8;
      const sx = 1 - offset / Terrain.SIZE_X;
      const sz = 1 - offset / Terrain.SIZE_Z;

      this.water.scale.set(sx, 1, sz);
      this.water.position.x += offset / 2;
      this.water.position.z += offset / 2;

      (<THREE.ShaderMaterial>this.water.material).uniforms.size.value = new THREE.Vector3(
        Terrain.SIZE_X,
        Terrain.SIZE_Y,
        Terrain.SIZE_Z
      );

      // water distorsion
      (<THREE.ShaderMaterial>this.water.material).uniforms.water_distortion.value =
        configSvc.config.ENABLE_WATER_EFFECTS && biome.getWaterDistortion();
      (<THREE.ShaderMaterial>this.water.material).uniforms.water_distortion_freq.value = biome.getWaterDistortionFreq();
      (<THREE.ShaderMaterial>this.water.material).uniforms.water_distortion_amp.value = biome.getWaterDistortionAmp();
    }
  }

  /**
   * Loads chunks in a specified area
   * @param {number} startRow
   * @param {number} startCol
   * @param {number} endRow
   * @param {number} endCol
   */
  loadChunks(startRow: number, startCol: number, endRow: number, endCol: number) {
    for (let row = startRow; row < endRow; row++) {
      for (let col = startCol; col < endCol; col++) {
        this.chunks.set(`${row}:${col}`, this.loadChunk(row, col));
      }
    }
  }

  /**
   * Loads and initializes a chunk at the given coordinates
   * @param {number} row
   * @param {number} col
   * @return {Chunk}
   */
  loadChunk(row: number, col: number): Chunk {
    const chunk = new Chunk(this.scene, this.generator, row, col);
    chunk.init(this);
    chunk.setVisible(false);

    return chunk;
  }

  /**
   * Update terrain
   * @param {THREE.Frustum} frustum
   * @param {THREE.Vector3} position
   * @param {number} delta
   */
  update(frustum: THREE.Frustum, position: THREE.Vector3, delta: number) {
    this.getChunkCoordAt(this.chunk, position.x, position.z);

    this.start.col = this.chunk.col - configSvc.config.MAX_VISIBLE_CHUNKS;
    this.start.row = this.chunk.row - configSvc.config.MAX_VISIBLE_CHUNKS;
    this.end.col = this.chunk.col + configSvc.config.MAX_VISIBLE_CHUNKS;
    this.end.row = this.chunk.row + configSvc.config.MAX_VISIBLE_CHUNKS;

    if (this.start.col < 0) {
      this.start.col = 0;
    }
    if (this.start.row < 0) {
      this.start.row = 0;
    }
    if (this.end.col > Terrain.NCHUNKS_X) {
      this.end.col = Terrain.NCHUNKS_X;
    }
    if (this.end.row > Terrain.NCHUNKS_Z) {
      this.end.row = Terrain.NCHUNKS_Z;
    }

    // reset previously visible chunks
    for (const chunk of this.visibleChunks) {
      chunk.setVisible(false);

      if (
        !(
          chunk.col >= this.start.col &&
          chunk.col < this.start.col + (this.end.col - this.start.col) &&
          chunk.row >= this.start.row &&
          chunk.row < this.start.row + (this.end.row - this.start.row)
        )
      ) {
        chunk.clean();
      }
    }

    this.visibleChunks = [];

    // loop through all chunks in range
    for (let i = this.start.row; i < this.end.row; i++) {
      for (let j = this.start.col; j < this.end.col; j++) {
        const chunk = this.getChunk(i, j);
        if (!chunk) {
          continue;
        }

        // chunk is visible in frustum
        if (frustum.intersectsBox(chunk.getBbox())) {
          if (chunk.isDirty()) {
            chunk.populate();
          }

          // mark this chunk as visible for the next update
          chunk.setVisible(true);
          chunk.update();

          this.visibleChunks.push(chunk);
        }
      }
    }

    const biome = this.generator.getBiome();
    if (biome.hasWater()) {
      // update water distorsion effect
      (<THREE.ShaderMaterial>this.water.material).uniforms.time.value = window.performance.now() / 1000;
      (<THREE.ShaderMaterial>this.water.material).needsUpdate = true;
    }
  }

  /**
   * Handle user interaction between the terrain and mouse
   * @param {THREE.Raycaster} raycaster
   * @param {MouseTypes} interactionType
   */
  handlePlayerInteraction(raycaster: THREE.Raycaster, interactionType: INTERACTION_TYPE) {
    switch (interactionType) {
      case INTERACTION_TYPE.MOUSE_MOVE:
        const now = window.performance.now();
        if (now >= this.lastInteractionUpdate) {
          this.lastInteractionUpdate = now + 1000 / 20; // only 20 checks per second

          this.manageObjectPreview(raycaster);
        } else {
          this.updateObjectPreview(raycaster);
        }
        break;

      case INTERACTION_TYPE.MOUSE_CLICK:
        this.placeObject(raycaster);
        this.generator.getBiome().handleClick(raycaster);
        break;

      case INTERACTION_TYPE.MOUSE_WHEEL_DOWN:
        this.changeObjectPreview(INTERACTION_TYPE.MOUSE_WHEEL_DOWN);
        break;

      case INTERACTION_TYPE.MOUSE_WHEEL_UP:
        this.changeObjectPreview(INTERACTION_TYPE.MOUSE_WHEEL_UP);
        break;

      case INTERACTION_TYPE.VOICE:
        this.placeObject(raycaster);
        break;

      default:
        break;
    }
  }

  /**
   * Place an object at the target location
   * @param {THREE.Raycaster} raycaster
   */
  placeObject(raycaster: THREE.Raycaster) {
    const biome = this.generator.getBiome();
    const intersections: THREE.Intersection[] = raycaster.intersectObjects([this.water, this.terrain], false);

    if (!this.previewObject) {
      if (crosshairSvc.status.state === CROSSHAIR_STATES.DEFAULT) {
        crosshairSvc.shake(true);
      }
      return;
    }

    for (const intersection of intersections) {
      const soundName = intersection.object === this.water ? 'splash' : 'set_down';

      // if water is disabled
      if (!biome.hasWater() && intersection.object === this.water) {
        continue;
      }

      const chunk = this.getChunkAt(intersection.point.x, intersection.point.z);
      chunk.placeObject(this.previewObject, { animate: true, save: true });

      this.previewItem = {
        ...this.previewItem,
        p: this.previewObject.position
      };

      if (multiplayerSvc.isUsed()) {
        multiplayerSvc.placeObject(this.previewItem);
        progressionSvc.increment(PROGRESSION_ONLINE_STORAGE_KEYS.place_object_online);
      }

      // increment progression
      progressionSvc.increment(PROGRESSION_COMMON_STORAGE_KEYS.objects_placed);
      if (playerSvc.isUnderwater()) progressionSvc.increment(PROGRESSION_COMMON_STORAGE_KEYS.objects_placed_submarine);
      progressionSvc.increment({
        name: CommonUtils.getObjectPlacedNameForAchievement(this.previewItem.n),
        value: CommonUtils.getObjectPlacedNameForAchievement(this.previewItem.n),
        show: false
      });

      this.objectAnimated = true;

      this.resetPreview();

      setTimeout(() => {
        this.objectAnimated = false;
        SoundManager.play(soundName);
      }, Chunk.ANIMATION_DELAY + 200
      );

      break;
    }
  }

  placeSpecialObject(
    special: ISpecialObject,
    ox: number = Terrain.SIZE_X / 2,
    oz: number = Terrain.SIZE_Z / 2,
    sizeX: number = Terrain.SIZE_X,
    sizeZ: number = Terrain.SIZE_Z
  ): THREE.Object3D {
    let object: THREE.Object3D;
    let chunk: Chunk;
    let item: IPick;

    const lowM = special.m !== null && special.m !== undefined ? (<ILowHigh>special.m).low : null;
    const highM = special.m !== null && special.m !== undefined ? (<ILowHigh>special.m).high : null;

    const lowE = special.e !== null && special.e !== undefined ? (<ILowHigh>special.e).low : null;
    const highE = special.e !== null && special.e !== undefined ? (<ILowHigh>special.e).high : null;

    let it = 0;

    do {
      it++;
      // prevent infinite loop
      if (it > 1000) {
        console.warn('Special object could not be placed');
        object = new THREE.Object3D();
        break;
      }

      const x = ox - sizeX / 2 + Math.floor(MathUtils.rng() * sizeX);
      const z = oz - sizeZ / 2 + Math.floor(MathUtils.rng() * sizeZ);
      const y = this.getHeightAt(x, z);
      const e = this.generator.computeElevationAt(x, z);
      const m = this.generator.computeMoistureAt(x, z);

      const s = new THREE.Vector3(World.OBJ_INITIAL_SCALE, World.OBJ_INITIAL_SCALE, World.OBJ_INITIAL_SCALE);
      const r = new THREE.Vector3(0, MathUtils.randomFloat(0, Math.PI * 2), 0);

      chunk = this.getChunkAt(x, z);

      if (special.underwater === false && y <= Chunk.SEA_LEVEL) { continue; }
      if ((lowE !== null && e < lowE) ||
        (highE !== null && e > highE) ||
        (lowM !== null && m < lowM) ||
        (highM !== null && m > highM)) { continue; }

      item = {
        s,
        p: new THREE.Vector3(x, y, z),
        r: new THREE.Euler().setFromVector3(r),
        n: special.stackReference,
        f: special.float
      };

      object = chunk.getObject(item);
    } while (!chunk.canPlaceObject(object));

    chunk.placeObject(object, { save: true });
    this.specialObjectList.push(object);

    return object;
  }

  manageSpecialObject(raycaster: THREE.Raycaster) {
    // special object interaction
    if (this.specialObjectList.length > 0) {
      const SOIntersection = this.getPlayerInteractionIntersection(raycaster, this.specialObjectList, true);

      if (SOIntersection !== null && SOIntersection.distance < Chunk.SO_INTERACTION_DISTANCE) {
        this.resetPreview();
        crosshairSvc.switch(CROSSHAIR_STATES.CAN_INTERACT_WITH_OBJECT);
        return true;
      }
    }

    return false;
  }

  /**
   * Handle mouse click in the 3d space
   * @param {THREE.Raycaster} raycaster
   */
  manageObjectPreview(raycaster: THREE.Raycaster) {
    if (this.objectAnimated) return;

    if (this.manageSpecialObject(raycaster)) {
      return;
    }

    // terrain/water interaction
    const intersection = this.getPlayerInteractionIntersection(raycaster, [this.water, this.terrain]);

    if (intersection === null) {
      // player is looking obviously outside of range
      crosshairSvc.show(false);
      this.resetPreview();
      return;
    }

    const chunk = this.getChunkAt(intersection.point.x, intersection.point.z);
    const validDistance = intersection.distance <= Chunk.INTERACTION_DISTANCE;

    const inNotInRange = !validDistance || this.intersectBorder(intersection.point);
    crosshairSvc.show(!inNotInRange);

    if (inNotInRange) {
      // bail out if the target is ouside the valid range
      this.resetPreview();
      return;
    }

    const biome = this.generator.getSubBiome(
      this.generator.computeElevationAt(intersection.point.x, intersection.point.z),
      this.generator.computeMoistureAt(intersection.point.x, intersection.point.z)
    );

    // if user fly over another biome or if preview item does not exist
    if (!this.previewItem || this.currentSubBiome !== biome || this.intersectionSurface !== intersection.object) {
      this.resetPreview();

      this.currentSubBiome = biome;
      this.subBiomeOrganisms = CommonUtils.shuffleArray(this.currentSubBiome.organisms);
      this.intersectionSurface = intersection.object;

      console.log(this.subBiomeOrganisms);

      // retrieve current preview object
      const item = chunk.pick(intersection.point.x, intersection.point.z, {
        force: true,
        float: (this.intersectionSurface === this.water)
      }, false);

      if (!item) {
        // bail out if no item gets picked
        this.resetPreview();
        return;
      }

      this.previewItem = item;
      this.previewObject = chunk.getObject(this.previewItem);

      this.scene.add(this.previewObject);
    }

    if (!chunk.canPlaceObject(this.previewObject)) {
      // bail out if the item cannot be placed at the current location
      this.resetPreview();
      return;
    }

    crosshairSvc.switch(CROSSHAIR_STATES.CAN_PLACE_OBJECT);
    this.previewObject.position.set(intersection.point.x, intersection.point.y, intersection.point.z);
  }

  changeObjectPreview(type: INTERACTION_TYPE) {

  }

  /**
   * Updates preview object
   * @param {THREE.Raycaster} raycaster
  */
  updateObjectPreview(raycaster: THREE.Raycaster) {
    if (this.previewObject) {
      const intersection = this.getPlayerInteractionIntersection(raycaster, [this.water, this.terrain]);
      this.previewObject.position.copy(intersection.point);
    }
  }

  /**
   * Returns the first intersection with the given objects and the mouse cursor raycaster
   * @param {THREE.Raycaster} raycaster
   * @param {THREE.Object3D[]} objects
   * @param {boolean} recursive
   * @return {THREE.Intersection | null}
   */
  getPlayerInteractionIntersection(raycaster: THREE.Raycaster, objects: THREE.Object3D[], recursive: boolean = false): THREE.Intersection | null {
    const intersections: THREE.Intersection[] = raycaster.intersectObjects(objects, recursive);

    for (const intersection of intersections) {
      return intersection;
    }
    return null;
  }

  /**
   * Retrieve the chunk coordinates at the given position
   * @param {Coord} out
   * @param {number} x
   * @param {number} z
   * @return {Coord}
   */
  getChunkCoordAt(out: Coord, x: number, z: number): Coord {
    out.row = (z / Chunk.DEPTH) | 0;
    out.col = (x / Chunk.WIDTH) | 0;

    return out;
  }

  /**
   * Retrieve the chunk at the given coordinates (row, col) if it exists
   * @param {number} row
   * @param {number} col
   * @return {Chunk|undefined}
   */
  getChunk(row: number, col: number): Chunk | undefined {
    return this.chunks.get(`${row}:${col}`);
  }

  /**
   * Retrieve the chunk at the given location (x, z) if it exists
   * @param {number} x
   * @param {number} z
   * @return {Chunk|undefined}
   */
  getChunkAt(x: number, z: number): Chunk {
    const p = this.getChunkCoordAt(new Coord(), x, z);
    return this.chunks.get(`${p.row}:${p.col}`);
  }

  /**
   * Retrieve the height at the given coordinates
   * @param {number} x
   * @param {number} z
   * @return {number}
   */
  getHeightAt(x: number, z: number): number {
    return this.generator.computeHeightAt(x, z);
  }

  /**
   * Construct a water border mesh
   * @param {number} nbRows
   * @param {number} nbCols
   * @param {Function} X Callback function returning the x component
   * @param {Function} Z Callback function returning the z component
   * @return {THREE.Mesh}
   */
  getWaterBorderMesh(
    nbRows: number,
    nbCols: number,
    X: Function,
    Z: Function,
    flipIndexes: boolean = false
  ): THREE.Mesh {
    const geometry = new THREE.Geometry();

    const nbVerticesZ = nbCols + 1;
    const nbVerticesY = nbRows + 1;

    for (let col = 0; col < nbVerticesZ; col++) {
      for (let row = 0; row < nbVerticesY; row++) {
        const x = X(row, col);
        const z = Z(row, col);
        const bottom = -Chunk.HEIGHT / 2 + 2048; // Math.min(this.generator.computeHeightAt(x, z) - 2048, Chunk.SEA_LEVEL);

        const y = row === 0 ? this.generator.computeWaterHeightAt(x, z) : bottom;

        geometry.vertices.push(new THREE.Vector3(x, y, z));
      }
    }

    for (let col = 0; col < nbCols; col++) {
      for (let row = 0; row < nbRows; row++) {
        const a = row + nbVerticesY * col;
        const b = row + 1 + nbVerticesY * col;
        const c = row + nbVerticesY * (col + 1);
        const d = row + 1 + nbVerticesY * (col + 1);

        const f1 = new THREE.Face3(a, b, d);
        const f2 = new THREE.Face3(d, c, a);

        const x1 = (geometry.vertices[a].x + geometry.vertices[b].x + geometry.vertices[d].x) / 3;
        const x2 = (geometry.vertices[d].x + geometry.vertices[c].x + geometry.vertices[a].x) / 3;

        const z1 = (geometry.vertices[a].z + geometry.vertices[b].z + geometry.vertices[d].z) / 3;
        const z2 = (geometry.vertices[d].z + geometry.vertices[c].z + geometry.vertices[a].z) / 3;

        const m1 = this.generator.computeWaterMoistureAt(x1, z1);
        const m2 = this.generator.computeWaterMoistureAt(x2, z2);

        f1.color = this.generator.getWaterColor(m1);
        f2.color = this.generator.getWaterColor(m2);

        geometry.faces.push(f1);
        geometry.faces.push(f2);
      }
    }

    if (flipIndexes) {
      let tmp;
      for (let f = 0; f < geometry.faces.length; f++) {
        tmp = geometry.faces[f].clone();
        geometry.faces[f].a = tmp.c;
        geometry.faces[f].c = tmp.a;
      }
    }

    // need to tell the engine we updated the vertices
    geometry.verticesNeedUpdate = true;
    geometry.colorsNeedUpdate = true;

    // need to update normals for smooth shading
    geometry.computeFaceNormals();
    geometry.computeVertexNormals();
    geometry.normalsNeedUpdate = true;

    return new THREE.Mesh(geometry, WATER_MATERIAL);
  }

  /**
   * Construct a water border mesh
   * @param {number} nbRows
   * @param {number} nbCols
   * @param {Function} X Callback function returning the x component
   * @param {Function} Z Callback function returning the z component
   * @return {THREE.Mesh}
   */
  getBorderMesh(nbRows: number, nbCols: number, X: Function, Z: Function): THREE.Mesh {
    const geometry = new THREE.Geometry();

    const nbVerticesX = nbCols + 1;
    const nbVerticesY = nbRows + 1;

    for (let col = 0; col < nbVerticesX; col++) {
      for (let row = 0; row < nbVerticesY; row++) {
        const x = X(row, col);
        const z = Z(row, col);
        const y = row === 0 ? this.generator.computeHeightAt(x, z) : -Chunk.HEIGHT / 2;

        geometry.vertices.push(new THREE.Vector3(x, y, z));
      }
    }

    for (let col = 0; col < nbCols; col++) {
      for (let row = 0; row < nbRows; row++) {
        const a = row + nbVerticesY * col;
        const b = row + 1 + nbVerticesY * col;
        const c = row + nbVerticesY * (col + 1);
        const d = row + 1 + nbVerticesY * (col + 1);

        const f1 = new THREE.Face3(a, b, d);
        const f2 = new THREE.Face3(d, c, a);

        f1.color = this.generator.getSubBiome(-Chunk.HEIGHT / 2 / Chunk.MAX_TERRAIN_HEIGHT, 0).color;
        f2.color = this.generator.getSubBiome(-Chunk.HEIGHT / 2 / Chunk.MAX_TERRAIN_HEIGHT, 0).color;

        geometry.faces.push(f1);
        geometry.faces.push(f2);
      }
    }

    // need to tell the engine we updated the vertices
    geometry.verticesNeedUpdate = true;
    geometry.colorsNeedUpdate = true;

    // need to update normals for smooth shading
    geometry.computeFaceNormals();
    geometry.computeVertexNormals();
    geometry.normalsNeedUpdate = true;

    return new THREE.Mesh(geometry, TERRAIN_MATERIAL);
  }

  private getBottomMesh(): THREE.Mesh {
    const geometry = new THREE.Geometry();

    geometry.vertices.push(new THREE.Vector3(0, -Terrain.SIZE_Y / 2, 0));
    geometry.vertices.push(new THREE.Vector3(Terrain.SIZE_X, -Terrain.SIZE_Y / 2, 0));
    geometry.vertices.push(new THREE.Vector3(Terrain.SIZE_X, -Terrain.SIZE_Y / 2, Terrain.SIZE_Z));
    geometry.vertices.push(new THREE.Vector3(0, -Terrain.SIZE_Y / 2, Terrain.SIZE_Z));

    const f1 = new THREE.Face3(0, 1, 2);
    const f2 = new THREE.Face3(2, 0, 3);
    f1.color = this.generator.getSubBiome(-Terrain.SIZE_Y / 2 / Chunk.MAX_TERRAIN_HEIGHT, 0).color;
    f2.color = this.generator.getSubBiome(-Terrain.SIZE_Y / 2 / Chunk.MAX_TERRAIN_HEIGHT, 0).color;
    geometry.faces.push(f1);
    geometry.faces.push(f2);

    return new THREE.Mesh(geometry, TERRAIN_MATERIAL);
  }

  private initMeshes() {
    // main terrain with borders
    this.terrain = new THREE.Mesh(new THREE.Geometry(), TERRAIN_MATERIAL);
    this.terrain.frustumCulled = true;
    this.terrain.castShadow = false;
    this.terrain.receiveShadow = true;
    this.layers.add(this.terrain);

    this.terrainSide = new THREE.Mesh(new THREE.Geometry(), TERRAIN_SIDE_MATERIAL);
    this.terrainSide.frustumCulled = true;
    this.terrainSide.castShadow = false;
    this.terrainSide.receiveShadow = false;
    this.layers.add(this.terrainSide);

    // water
    this.water = new THREE.Mesh(new THREE.Geometry(), WATER_MATERIAL);
    this.water.frustumCulled = true;
    this.water.castShadow = false;
    this.water.receiveShadow = true;
    this.layers.add(this.water);

    if (configSvc.debug) this.layers.add(<THREE.Object3D>Terrain.createRegionWaterBoundingBoxHelper());

    this.scene.add(this.layers);
  }

  private watchObjectPlaced() {
    multiplayerSvc.objectPlaced$.subscribe(
      ({ item, animate }: IOnlineObject) => {
        const chunk = this.getChunkAt(item.p.x, item.p.z);
        const object = chunk.getObject(item);
        chunk.placeObject(object, { animate, save: true, });
      }
    );
  }

  private resetPreview() {
    this.previewItem = null;
    this.currentSubBiome = null;
    this.intersectionSurface = null;

    if (this.previewObject) {
      this.scene.remove(this.previewObject);
      this.previewObject = null;
    }

    crosshairSvc.switch(CROSSHAIR_STATES.DEFAULT);
  }

  private intersectBorder(intersection: THREE.Vector3): boolean {
    const offset = 200;
    return (
      MathUtils.between(intersection.x, -offset, offset) ||
      MathUtils.between(intersection.x, Terrain.SIZE_X - offset, Terrain.SIZE_X + offset) ||
      MathUtils.between(intersection.z, -offset, offset) ||
      MathUtils.between(intersection.z, Terrain.SIZE_Z - offset, Terrain.SIZE_Z + offset)
    );
  }

  public getScene(): THREE.Scene {
    return this.scene;
  }

  public getBiomeGenerator(): BiomeGenerator {
    return this.generator;
  }

  public getWorld(): World {
    return this.world;
  }

  public getBiome(): Biome {
    return this.generator.getBiome();
  }

  /**
   * Retrieve the whole region's bounding box
   * @return {THREE.Box3}
   */
  static createRegionBoundingBox(): THREE.Box3 {
    return new THREE.Box3().setFromCenterAndSize(
      new THREE.Vector3(Terrain.SIZE_X / 2, Terrain.SIZE_Y / 2, Terrain.SIZE_Z / 2),
      new THREE.Vector3(Terrain.SIZE_X, Terrain.SIZE_Y, Terrain.SIZE_Z)
    );
  }

  /**
   * Retrieve the region's water bounding box
   * @return {THREE.Box3}
   */
  static createRegionWaterBoundingBox(): THREE.Box3 {
    return new THREE.Box3().setFromCenterAndSize(
      new THREE.Vector3(Terrain.SIZE_X / 2, Chunk.SEA_LEVEL - Terrain.SIZE_Y / 4, Terrain.SIZE_Z / 2),
      new THREE.Vector3(Terrain.SIZE_X, Terrain.SIZE_Y / 2, Terrain.SIZE_Z)
    );
  }

  /**
   * Retrieve the region's bounding box helper
   * @param {THREE.Box3|null} bbox Region's bounding box (if not set it will be created)
   * @return {THREE.Box3Helper}
   */
  static createRegionBoundingBoxHelper(bbox: THREE.Box3 = null): THREE.Box3Helper {
    return new THREE.Box3Helper(bbox ? bbox : Terrain.createRegionBoundingBox(), 0xff0000);
  }

  /**
   * Retrieve the region's water bounding box helper
   * @param {THREE.Box3|null} bbox Region's bounding box (if not set it will be created)
   * @return {THREE.Box3Helper}
   */
  static createRegionWaterBoundingBoxHelper(bbox: THREE.Box3 = null): THREE.Box3Helper {
    return new THREE.Box3Helper(bbox ? bbox : Terrain.createRegionWaterBoundingBox(), 0x0000ff);
  }
}

export default Terrain;
