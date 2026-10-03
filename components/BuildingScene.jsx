"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

const POSITIONS = [
  [-3.2, 1, 0], [0, 1, 0], [3.2, 1, 0],
  [-3.2, 2, 0], [0, 2, 0], [3.2, 2, 0],
  [-3.2, 3, 0], [0, 3, 0], [3.2, 3, 0],
];

function heatColor(value, min, max) {
  const ratio = Math.max(0, Math.min(1, (value - min) / Math.max(max - min, 1)));
  // Deliberately use the whole ramp. Relative load needs clear visual separation
  // between rooms, even when the campus forecast values are close together.
  return new THREE.Color().setHSL(0.60 - ratio * 0.59, 0.74, 0.49);
}

export default function BuildingScene({ rooms, hour, selectedRoom, onSelectRoom, floorFilter }) {
  const hostRef = useRef(null);
  const liveRef = useRef({ rooms, hour, selectedRoom, onSelectRoom, floorFilter });
  liveRef.current = { rooms, hour, selectedRoom, onSelectRoom, floorFilter };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      host.dataset.webgl = "unavailable";
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0xeef3f8, 1);
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeef3f8);
    scene.fog = new THREE.Fog(0xeef3f8, 17, 32);
    const camera = new THREE.PerspectiveCamera(34, host.clientWidth / host.clientHeight, 0.1, 100);
    let azimuth = Math.PI / 4.9;
    let elevation = 0.24;
    let radius = 16.5;
    const aim = new THREE.Vector3(0, 3.5, 0);
    const placeCamera = () => {
      camera.position.set(
        aim.x + radius * Math.cos(elevation) * Math.sin(azimuth),
        aim.y + radius * Math.sin(elevation),
        aim.z + radius * Math.cos(elevation) * Math.cos(azimuth),
      );
      camera.lookAt(aim);
    };
    placeCamera();

    scene.add(new THREE.HemisphereLight(0xfafcff, 0x7f9ca8, 2.7));
    const sun = new THREE.DirectionalLight(0xffffff, 2.8);
    sun.position.set(-7, 13, 10);
    scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: 0xeaf1f4, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.12;
    scene.add(ground);

    const floorGroup = new THREE.Group();
    const roomsGroup = new THREE.Group();
    const siteGroup = new THREE.Group();
    scene.add(floorGroup, roomsGroup, siteGroup);
    const lawn = new THREE.Mesh(
      new THREE.BoxGeometry(17, 0.16, 8.3),
      new THREE.MeshStandardMaterial({ color: 0xcbdcce, roughness: 0.94 }),
    );
    lawn.position.set(0, -0.05, -0.15);
    siteGroup.add(lawn);
    const approach = new THREE.Mesh(
      new THREE.BoxGeometry(13.5, 0.18, 1.15),
      new THREE.MeshStandardMaterial({ color: 0xf9fbfc, roughness: 0.88 }),
    );
    approach.position.set(0, 0.1, 2.55);
    siteGroup.add(approach);
    for (let floor = 1; floor <= 3; floor++) {
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(10.15, 0.15, 4.15),
        new THREE.MeshStandardMaterial({ color: 0xf9fbfd, roughness: 0.82, metalness: 0.04 }),
      );
      slab.position.set(0, (floor - 1) * 2.42 + 0.1, 0);
      slab.userData.floor = floor;
      floorGroup.add(slab);
    }
    const foot = new THREE.Mesh(
      new THREE.BoxGeometry(10.8, 0.26, 4.75),
      new THREE.MeshStandardMaterial({ color: 0xbac8d0, roughness: 0.72, metalness: 0.12 }),
    );
    foot.position.y = 0.18;
    floorGroup.add(foot);

    const roomMeshes = new Map();
    const frameMaterial = new THREE.MeshStandardMaterial({ color: 0xf8fbfd, roughness: 0.38, metalness: 0.18 });
    const glassMaterial = new THREE.MeshStandardMaterial({ color: 0x3e6682, roughness: 0.16, metalness: 0.28, transparent: true, opacity: 0.32 });
    POSITIONS.forEach(([x, floor]) => {
      const room = new THREE.Mesh(
        new THREE.BoxGeometry(2.76, 2.08, 3.38),
        new THREE.MeshStandardMaterial({ color: 0x5e8ec6, roughness: 0.42, metalness: 0.06, emissive: 0x000000 }),
      );
      room.position.set(x, (floor - 1) * 2.42 + 1.22, 0);
      room.userData.floor = floor;
      roomsGroup.add(room);
      roomMeshes.set(`${floor}-${(x + 3.2) / 3.2}`, room);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(2.82, 1.56, 0.07), glassMaterial.clone());
      glass.position.set(x, room.position.y + 0.24, 1.72);
      glass.userData.floor = floor;
      roomsGroup.add(glass);
      const topRail = new THREE.Mesh(new THREE.BoxGeometry(2.96, 0.075, 0.13), frameMaterial);
      topRail.position.set(x, room.position.y + 1.075, 1.78);
      topRail.userData.floor = floor;
      roomsGroup.add(topRail);
      const divider = new THREE.Mesh(new THREE.BoxGeometry(0.075, 2.18, 3.55), frameMaterial);
      divider.position.set(x + 1.48, room.position.y, 0);
      divider.userData.floor = floor;
      roomsGroup.add(divider);
    });
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(10.35, 0.18, 4.35),
      new THREE.MeshStandardMaterial({ color: 0x183d55, roughness: 0.55, metalness: 0.22 }),
    );
    roof.position.set(0, 7.45, 0);
    floorGroup.add(roof);
    const plant = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.34, 0.95),
      new THREE.MeshStandardMaterial({ color: 0x769496, roughness: 0.62, metalness: 0.18 }),
    );
    plant.position.set(1.8, 7.72, 0);
    floorGroup.add(plant);
    const stairCore = new THREE.Mesh(
      new THREE.BoxGeometry(1.05, 7.28, 3.92),
      new THREE.MeshStandardMaterial({ color: 0x526d81, roughness: 0.5, metalness: 0.12 }),
    );
    stairCore.position.set(-5.06, 3.7, 0);
    floorGroup.add(stairCore);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let down = null;
    let dragging = false;
    const canvas = renderer.domElement;
    const onDown = (event) => { down = [event.clientX, event.clientY]; dragging = false; canvas.setPointerCapture(event.pointerId); };
    const onMove = (event) => {
      if (!down) return;
      const dx = event.clientX - down[0], dy = event.clientY - down[1];
      if (Math.abs(dx) + Math.abs(dy) > 3) dragging = true;
      if (dragging) {
        azimuth -= dx * 0.008;
        elevation = Math.max(0.06, Math.min(0.75, elevation + dy * 0.004));
        down = [event.clientX, event.clientY];
        placeCamera();
      }
    };
    const onUp = (event) => {
      if (!dragging && down) {
        const rect = canvas.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObjects([...roomMeshes.values()], false)[0];
        if (hit?.object.userData.roomId) liveRef.current.onSelectRoom(hit.object.userData.roomId);
      }
      down = null;
      dragging = false;
    };
    const onWheel = (event) => {
      event.preventDefault();
      radius = Math.max(10, Math.min(21, radius + event.deltaY * 0.008));
      placeCamera();
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    const resize = new ResizeObserver(() => {
      const width = host.clientWidth, height = host.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });
    resize.observe(host);
    let frame;
    const draw = () => { frame = requestAnimationFrame(draw); renderer.render(scene, camera); };
    draw();

    host._setBuildingView = ({ rooms, hour, selectedRoom, floorFilter }) => {
      const values = rooms.map((room) => room.forecast_kwh[hour] || 0);
      const max = Math.max(...values, 1);
      const min = Math.min(...values);
      rooms.forEach((room, index) => {
        const mesh = [...roomMeshes.values()][index];
        if (!mesh) return;
        const value = room.forecast_kwh[hour] || 0;
        const color = heatColor(value, min, max);
        const material = mesh.material;
        material.color.copy(color);
        material.emissive.copy(color);
        material.emissiveIntensity = room.id === selectedRoom ? 0.24 : 0.055;
        material.opacity = floorFilter === "all" || room.floor === Number(floorFilter) ? 1 : 0.18;
        material.transparent = material.opacity < 1;
        mesh.userData.roomId = room.id;
        mesh.userData.name = room.name;
      });
      [...floorGroup.children, ...roomsGroup.children].forEach((mesh) => {
        if (mesh.userData.floor) mesh.visible = floorFilter === "all" || mesh.userData.floor === Number(floorFilter);
      });
    };

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("wheel", onWheel);
      scene.traverse((object) => {
        object.geometry?.dispose();
        if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
        else object.material?.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  useEffect(() => {
    hostRef.current?._setBuildingView?.({ rooms, hour, selectedRoom, floorFilter });
  }, [rooms, hour, selectedRoom, floorFilter]);

  return <div className="building-canvas" ref={hostRef} aria-label="Interactive three-dimensional estimated room load model" />;
}
