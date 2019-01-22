import * as THREE from 'three';
import * as TWEEN from '@tweenjs/tween.js';

import World from '@world/World';
import Terrain from '@world/Terrain';
import Chunk from '@world/Chunk';
import BiomeGenerator from '@world/BiomeGenerator';
import MathUtils from '@utils/Math.utils';
import CommonUtils from '@utils/Common.utils';

import ConfigService, { configSvc } from '@app/shared/services/config.service';
import PlayerService, { playerSvc } from '@shared/services/player.service';
import ProgressionService, { progressionSvc } from '@achievements/services/progression.service';
import MultiplayerService, { multiplayerSvc } from '@online/services/multiplayer.service';

import { ICloudData } from '@world/models/cloudData.model';

import { PROGRESSION_WEATHER_STORAGE_KEYS } from '@achievements/constants/progressionWeatherStorageKeys.constants';

class Weather {
  private static FOG_COLORS: Map<number, THREE.Color> = new Map<number, THREE.Color>();

  private static RAIN_SPEED: number = 200;
  private static FOG_COLOR1: string = '#212C37';
  private static FOG_COLOR2: string = '#B1D8FF';
  private static TICK_RATIO_DIV: number = 24000;

  private static SOLAR_SYSTEM_RADIUS: number = Math.max(Terrain.SIZE_X, Terrain.SIZE_Z) * 1.2;

  private scene: THREE.Scene;
  private generator: BiomeGenerator;

  private progressionSvc: ProgressionService;
  private playerSvc: PlayerService;
  private multiplayerSvc: MultiplayerService;

  private clouds: THREE.Group;
  private wind: THREE.Vector3;

  private startTime: number;

  // lights
  private hemisphereLight: THREE.HemisphereLight;
  private ambientLight: THREE.AmbientLight;
  private sunlight: THREE.DirectionalLight;
  private moonlight: THREE.DirectionalLight;
  private lightHelper: THREE.ArrowHelper;

  private moonBoundLight: THREE.SpotLight;
  private sunBoundLight: THREE.SpotLight;

  // stars
  private starsSystem: THREE.Points;

  // sun objects
  private sun: THREE.Object3D;
  private moon: THREE.Object3D;

  private fogColor: THREE.Color = new THREE.Color();
  /**
  * Weather constructor
  * @param {THREE.Scene} scene
  * @param {BiomeGenerator} generator
  */
  constructor(scene: THREE.Scene, generator: BiomeGenerator) {
    this.scene = scene;
    this.generator = generator;

    this.playerSvc = playerSvc;
    this.progressionSvc = progressionSvc;
    this.multiplayerSvc = multiplayerSvc;

    this.startTime = window.performance.now();

    this.watchStartTime();

    // precalculate fog colors
    for (let i = 1; i < Weather.SOLAR_SYSTEM_RADIUS; i++) {
      this.computeFogColor(i);
    }
  }

  /**
  * @param {number} delta
  */
  update(delta: number) {
    this.updateClouds(delta);
    this.updateSun();
    this.updateMoon();
    this.updateLights();
    this.updateStars();
  }

  initClouds() {
    // clouds
    this.clouds = new THREE.Group();
    this.clouds.frustumCulled = true;
    this.clouds.castShadow = true;
    this.clouds.receiveShadow = true;
    this.scene.add(this.clouds);

    this.wind = new THREE.Vector3(0, 0, MathUtils.randomInt(600, 1200) * Math.sign(Math.random() - 0.5));

    // wind direction helper
    if (configSvc.debug) {
      const arrowHelper = new THREE.ArrowHelper(this.wind, new THREE.Vector3(Terrain.SIZE_X / 2, Chunk.CLOUD_LEVEL, Terrain.SIZE_Z / 2), 10000, 0xff0000);
      this.scene.add(arrowHelper);
    }
  }

  initRain() {
    if (!configSvc.config.ENABLE_WEATHER_EFFECTS) { return; }

    this.clouds.children.forEach((cloud: THREE.Mesh) => {
      cloud.updateMatrixWorld(true);

      // particles
      const size = new THREE.Box3().setFromObject(cloud).getSize(new THREE.Vector3());
      const particles = new THREE.Geometry();
      const particleCount = (size.x * size.y * size.z) / 250000000000; // calculate the amount of rain drops from cloud volume

      for (let i = 0; i < particleCount; i++) {
        particles.vertices.push(new THREE.Vector3(
          MathUtils.randomInt(-size.x / 3, size.x / 3),
          MathUtils.randomInt(Chunk.SEA_LEVEL, Chunk.CLOUD_LEVEL),
          MathUtils.randomInt(-size.z / 3, size.z / 3)
        ));
      }

      // material
      const material = new THREE.PointsMaterial({
        size: 1024,
        map: World.LOADED_TEXTURES.get('raindrop'),
        blending: THREE.AdditiveBlending,
        depthTest: true,
        transparent: true,
        opacity: 0.50
      });

      const data: ICloudData = {
        particles,
        particleMaterial: material,
        particleSystem: new THREE.Points(particles, material),
        isRaininig: false,
        allParticlesDropped: false,
        scale: cloud.scale.clone(),
        animating: false
      };

      this.scene.add(data.particleSystem);

      cloud.userData = data;
    });
  }

  initLights() {
    const target = new THREE.Object3D();
    target.position.set(Terrain.SIZE_X / 2, 0, Terrain.SIZE_Z / 2);
    this.scene.add(target);

    this.hemisphereLight = new THREE.HemisphereLight(0x3a6aa0, 0xffffff, 0.75);
    this.hemisphereLight.position.set(0, Chunk.SEA_LEVEL, 0);
    this.hemisphereLight.castShadow = false;
    this.scene.add(this.hemisphereLight);

    this.ambientLight = new THREE.AmbientLight(0xB1D8FF, 0.35);
    this.ambientLight.position.set(0, Chunk.HEIGHT, 15000);
    this.ambientLight.castShadow = false;
    this.scene.add(this.ambientLight);

    this.initSunlight();
    this.initMoonlight();

    this.moonBoundLight = new THREE.SpotLight(0xc5dadd, 0.1, 0, Math.PI / 2, 1.0);
    this.moonBoundLight.castShadow = false;
    this.moonBoundLight.target = target;
    this.scene.add(this.moonBoundLight);

    this.sunBoundLight = new THREE.SpotLight(0xfd5e53, 1.0, 0, Math.PI / 2, 1.0); // 0xfd5e53
    this.sunBoundLight.castShadow = false;
    this.sunBoundLight.target = target;
    this.scene.add(this.sunBoundLight);

    /*
    if (configSvc.debug) {
      this.scene.add(new THREE.SpotLightHelper(this.moonBoundLight));
      this.scene.add(new THREE.SpotLightHelper(this.sunBoundLight));
    }
    */

    const materialCallback = (mesh) => {
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.material.transparent = true;
      mesh.material.side = THREE.FrontSide;
    };

    this.sun = World.LOADED_MODELS.get('sun').clone();
    this.sun.children[0].material = new THREE.MeshLambertMaterial({ color: 0xffec83, emissive: 0x505050, emissiveIntensity: 1.0, reflectivity: 0.75 });
    this.sun.children.forEach(materialCallback);
    this.sun.position.copy(this.sunlight.position);
    // this.sun.visible = configSvc.debug;

    this.moon = World.LOADED_MODELS.get('moon').clone();
    this.moon.children[0].material = new THREE.MeshLambertMaterial({ color: 0x83d8ff, emissive: 0x505050, emissiveIntensity: 1.0, reflectivity: 0.75 });
    this.moon.children.forEach(materialCallback);
    this.moon.position.copy(this.sunlight.position);
    // this.moon.visible = configSvc.debug;

    this.scene.add(this.sun, this.moon);

    if (configSvc.debug) {
      const dirHelper = new THREE.Vector3().subVectors(this.sunlight.target.position.clone(), this.sunlight.position.clone()).normalize();
      this.lightHelper = new THREE.ArrowHelper(dirHelper, this.sunlight.position.clone(), Weather.SOLAR_SYSTEM_RADIUS, 0xff0000, 10000);
      this.scene.add(this.lightHelper);
    }
  }

  private initSunlight() {
    const d = 1000000;
    this.sunlight = new THREE.DirectionalLight(0xffffff, 0.25);

    this.sunlight.target.position.set(Terrain.SIZE_X / 2, 0, Terrain.SIZE_Z / 2);
    this.sunlight.target.updateMatrixWorld(true);

    this.sunlight.position.set(Terrain.SIZE_X / 2, Weather.SOLAR_SYSTEM_RADIUS, Terrain.SIZE_Z / 2);

    this.sunlight.castShadow = true;
    this.sunlight.shadow.mapSize.width = 4096;
    this.sunlight.shadow.mapSize.height = 4096;
    this.sunlight.shadow.camera.visible = false;
    this.sunlight.shadow.camera.castShadow = false;
    this.sunlight.shadow.bias = 0.0001;
    this.sunlight.shadow.camera.left = -d;
    this.sunlight.shadow.camera.right = d;
    this.sunlight.shadow.camera.top = d;
    this.sunlight.shadow.camera.bottom = -d;
    this.sunlight.shadow.camera.near = 150;
    this.sunlight.shadow.camera.far = 1000000;

    this.scene.add(this.sunlight);
  }

  private initMoonlight() {
    const d = 1000000;
    this.moonlight = new THREE.DirectionalLight(0x5fc2eb, 0.15);

    this.moonlight.target.position.set(Terrain.SIZE_X / 2, 0, Terrain.SIZE_Z / 2);
    this.moonlight.target.updateMatrixWorld(true);

    this.moonlight.position.set(Terrain.SIZE_X / 2, Weather.SOLAR_SYSTEM_RADIUS, Terrain.SIZE_Z / 2);

    this.moonlight.castShadow = true;
    this.moonlight.shadow.mapSize.width = 4096;
    this.moonlight.shadow.mapSize.height = 4096;
    this.moonlight.shadow.camera.visible = false;
    this.moonlight.shadow.camera.castShadow = false;
    this.moonlight.shadow.bias = 0.0001;
    this.moonlight.shadow.camera.left = -d;
    this.moonlight.shadow.camera.right = d;
    this.moonlight.shadow.camera.top = d;
    this.moonlight.shadow.camera.bottom = -d;
    this.moonlight.shadow.camera.near = 150;
    this.moonlight.shadow.camera.far = 1000000;

    this.scene.add(this.moonlight);
  }

  initStars() {
    const starsCount: number = 1000;
    const stars = new THREE.Geometry();

    for (let i = 0; i < starsCount; i++) {

      const u = MathUtils.rng();
      const v = MathUtils.rng();
      const radius = Chunk.HEIGHT * 2.5;
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);

      const x = (radius * Math.sin(phi) * Math.cos(theta));
      const y = (radius * Math.sin(phi) * Math.sin(theta));
      const z = (radius * Math.cos(phi));

      stars.vertices.push(new THREE.Vector3(x, y, z));
    }

    const material = new THREE.PointsMaterial({
      size: 1500,
      color: '#fefdef',
      transparent: true,
      opacity: 0.75,
      fog: false,
    });

    this.starsSystem = new THREE.Points(stars, material);
    this.starsSystem.position.copy(this.playerSvc.getPosition());
    this.starsSystem.frustumCulled = false;

    this.scene.add(this.starsSystem);
  }

  /**
  * Cloud world entry animation
  * @param {THREE.Object3D} cloud
  */
  private animateCloudIn(cloud: THREE.Object3D) {
    new TWEEN.Tween(cloud.scale)
      .to(cloud.userData.scale, 750)
      .delay(500)
      .easing(TWEEN.Easing.Quadratic.Out)
      .onComplete(() => {
        cloud.userData.animating = false;
      })
      .start();
  }

  /**
  * Cloud world exit animation
  * @param {THREE.Object3D} cloud
  * @param {THREE.Vector3} position Position to set after the animation is finished
  */
  private animateCloudOut(cloud: THREE.Object3D, position: THREE.Vector3) {
    cloud.userData.animating = true;

    new TWEEN.Tween(cloud.scale)
      .to(new THREE.Vector3(0.00001, 0.00001, 0.00001), 750)
      .easing(TWEEN.Easing.Quadratic.Out)
      .onComplete(() => {
        cloud.position.copy(position);
        this.animateCloudIn(cloud);
      })
      .start();
  }

  /**
  * Update cloud movements an weather particles
  * @param {number} delta
  */
  private updateClouds(delta: number) {
    const playerPosition = this.playerSvc.getPosition();

    for (const cloud of this.clouds.children) {
      // move cloud
      if (!cloud.userData.animating) {
        cloud.position.add(this.wind.clone().multiplyScalar(delta));
      }

      // reset position if the cloud goes off the edges of the world
      const bbox: THREE.Box3 = new THREE.Box3().setFromObject(cloud);
      const size: THREE.Vector3 = bbox.getSize(new THREE.Vector3());

      // animate cloud when it's off bounds
      if (!cloud.userData.animating) {
        if (cloud.position.x < 0) {
          const position = cloud.position.clone();
          position.x = Terrain.SIZE_X;
          this.animateCloudOut(cloud, position);
        }
        if (cloud.position.z < 0) {
          const position = cloud.position.clone();
          position.z = Terrain.SIZE_Z;
          this.animateCloudOut(cloud, position);
        }
        if (cloud.position.x > Terrain.SIZE_X) {
          const position = cloud.position.clone();
          position.x = 0;
          this.animateCloudOut(cloud, position);
        }
        if (cloud.position.z > Terrain.SIZE_Z) {
          const position = cloud.position.clone();
          position.z = 0;
          this.animateCloudOut(cloud, position);
        }
      }

      if (!configSvc.config.ENABLE_WEATHER_EFFECTS) { continue; }

      // rain
      const rainData = cloud.userData as ICloudData;

      rainData.isRaininig = this.generator.computeWaterMoistureAt(cloud.position.x, cloud.position.z) >= 0.65;
      if (!rainData.isRaininig) rainData.allParticlesDropped = rainData.particles.vertices.every(position => position.y === Chunk.CLOUD_LEVEL);
      if (rainData.allParticlesDropped) {
        rainData.particleMaterial.visible = false;
        rainData.particles.vertices.forEach(position => position.set(
          MathUtils.randomInt(-size.x / 3, size.x / 3),
          MathUtils.randomInt(Chunk.SEA_LEVEL, Chunk.CLOUD_LEVEL),
          MathUtils.randomInt(-size.z / 3, size.z / 3)
        ));
      }

      // set particle system position
      rainData.particleSystem.position.setX(cloud.position.x);
      rainData.particleSystem.position.setZ(cloud.position.z);

      rainData.particles.vertices.forEach(position => {
        if (position.y <= Chunk.SEA_ELEVATION) position.y = Chunk.CLOUD_LEVEL - size.y / 2;
        if (rainData.isRaininig) {
          rainData.particleMaterial.visible = true;
          position.y -= Weather.RAIN_SPEED;
        } else {
          // rain stop
          if (position.y < Chunk.CLOUD_LEVEL - 1000) {
            position.y -= Weather.RAIN_SPEED;
          } else {
            position.set(cloud.position.x, Chunk.CLOUD_LEVEL - size.y / 2, cloud.position.z);
          }

        }
      });

      // progression
      const playerPositionAtCloudElevation = new THREE.Vector3().copy(playerPosition).setY(Chunk.CLOUD_LEVEL + 500);
      if (rainData.isRaininig && MathUtils.between(playerPosition.y, Chunk.SEA_LEVEL, Chunk.CLOUD_LEVEL) && bbox.containsPoint(playerPositionAtCloudElevation)) {
        this.progressionSvc.increment(PROGRESSION_WEATHER_STORAGE_KEYS.under_rain);
      }

      rainData.particles.verticesNeedUpdate = true;
    }
  }

  private updateSun() {
    const elapsedTime: number = (window.performance.now() - this.startTime) / Weather.TICK_RATIO_DIV;

    const x: number = Terrain.SIZE_X / 2 + Weather.SOLAR_SYSTEM_RADIUS * Math.cos(elapsedTime);
    const y: number = Weather.SOLAR_SYSTEM_RADIUS * Math.sin(elapsedTime);

    this.sunlight.position.setX(x);
    this.sunlight.position.setY(y);

    this.sun.position.copy(this.sunlight.position);
    this.sunlight.shadow.camera.updateProjectionMatrix();

    this.sunBoundLight.position.copy(this.sunlight.position);

    const bbox: THREE.Box3 = new THREE.Box3().setFromObject(this.sun);

    if (bbox.containsPoint(this.playerSvc.getPosition())) {
      this.progressionSvc.increment(PROGRESSION_WEATHER_STORAGE_KEYS.in_sun);
    }

    if (configSvc.debug) {
      this.lightHelper.position.copy(this.sunlight.position);
      this.lightHelper.setDirection(new THREE.Vector3().subVectors(this.sunlight.target.position.clone(), this.sunlight.position.clone()).normalize());
    }
  }

  private updateMoon() {
    this.moonlight.position.set(Terrain.SIZE_X - this.sun.position.x, -this.sun.position.y, this.sun.position.z);

    this.moon.position.copy(this.moonlight.position);
    this.moonlight.shadow.camera.updateProjectionMatrix();

    this.moonBoundLight.position.copy(this.moonlight.position);
  }

  private updateLights() {
    const y = this.sunlight.position.y;

    this.hemisphereLight.intensity = MathUtils.mapInterval(Math.abs(y), 0, Weather.SOLAR_SYSTEM_RADIUS, 0.35, 0.75);
    // this.ambientLight.intensity = MathUtils.mapInterval(y, 0, Chunk.HEIGHT, 0.2, 0.35);
    this.sunlight.intensity = MathUtils.mapInterval(y, 0, Weather.SOLAR_SYSTEM_RADIUS, 0.0, 0.25);

    if (y > 0) {
      const c: THREE.Color = this.computeFogColor(y);

      this.ambientLight.color = c;
      this.fogColor = c;
    }

    if (y >= -Weather.SOLAR_SYSTEM_RADIUS / 4) {
      this.sunBoundLight.intensity = MathUtils.mapInterval(y, -Weather.SOLAR_SYSTEM_RADIUS / 4, Weather.SOLAR_SYSTEM_RADIUS, 1.0, 0);
    } else {
      this.sunBoundLight.intensity = MathUtils.mapInterval(Math.abs(y), Weather.SOLAR_SYSTEM_RADIUS / 4, Weather.SOLAR_SYSTEM_RADIUS, 1.0, 0);
    }
  }

  private updateStars() {
    const position = this.playerSvc.getPosition();
    this.starsSystem.position.copy(position);
  }

  private computeFogColor(y: number): THREE.Color {
    const t = Math.floor(y / Weather.SOLAR_SYSTEM_RADIUS * 360) / 360;

    if (!Weather.FOG_COLORS.has(t)) {
      const color = new THREE.Color(CommonUtils.lerpColor(Weather.FOG_COLOR1, Weather.FOG_COLOR2, t));
      Weather.FOG_COLORS.set(t, color);

      return color;
    }
    return Weather.FOG_COLORS.get(t);
  }

  private watchStartTime() {
    this.multiplayerSvc.time$.subscribe(time => this.startTime = time);
  }

  getClouds(): THREE.Group {
    return this.clouds;
  }

  getFogColor(): THREE.Color {
    return this.fogColor;
  }
}

export default Weather;