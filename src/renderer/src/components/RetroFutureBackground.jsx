import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import * as THREE from 'three'

function Sun() {
  const ref = useRef()
  const materialRef = useRef()
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 768
    c.height = 768
    const ctx = c.getContext('2d')
    const g = ctx.createLinearGradient(0, 0, 0, 768)
    g.addColorStop(0, '#ff0a84')
    g.addColorStop(0.48, '#ff3e55')
    g.addColorStop(0.78, '#ff8d24')
    g.addColorStop(1, '#ffd84a')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(384, 384, 374, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalCompositeOperation = 'destination-out'
    let currentY = 306
    let gapThickness = 8
    let bandThickness = 44
    for (let i = 0; i < 6; i++) {
      ctx.fillRect(0, currentY, 768, gapThickness)
      currentY += gapThickness + bandThickness
      gapThickness += 5
      bandThickness -= 2
    }
    const texture = new THREE.CanvasTexture(c)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    return texture
  }, [])
  const uniforms = useMemo(() => ({ map: { value: tex }, time: { value: 0 } }), [tex])
  useFrame(({ clock }) => {
    const time = clock.getElapsedTime()
    if (ref.current) ref.current.scale.setScalar(1 + Math.sin(time * 1.5) * 0.012)
    if (materialRef.current) materialRef.current.uniforms.time.value = time
  })
  return (
    <mesh ref={ref} position={[0, 6, -50]}>
      <planeGeometry args={[32, 32]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        fog={false}
        toneMapped={false}
        blending={THREE.AdditiveBlending}
        vertexShader={`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`}
        fragmentShader={`
          uniform sampler2D map;
          uniform float time;
          varying vec2 vUv;

          float rand(vec2 co){
            return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
          }

          void main(){
            vec4 texel = texture2D(map, vUv);
            if (texel.a < 0.02) discard;

            float scanline = 0.74 + 0.26 * sin((vUv.y + time * 0.012) * 980.0);
            float phosphor = 0.94 + 0.06 * sin(vUv.x * 1450.0);
            float rollingBand = 1.0 - smoothstep(0.0, 0.055, abs(fract(vUv.y * 1.8 - time * 0.16) - 0.5)) * 0.14;
            float noise = 0.96 + rand(floor(vUv * vec2(480.0, 360.0)) + time) * 0.08;
            float rim = smoothstep(0.48, 0.36, length(vUv - vec2(0.5)));
            float flicker = 0.97 + sin(time * 24.0) * 0.018 + sin(time * 7.0) * 0.012;

            vec3 color = texel.rgb * scanline * phosphor * rollingBand * noise * flicker;
            color += texel.rgb * rim * 0.08;
            gl_FragColor = vec4(color, texel.a);
          }
        `}
      />
    </mesh>
  )
}

function WireMountainLayer({
  position,
  seed = 0,
  opacity = 0.85,
  glow = 2.5,
  width = 220,
  height = 3.2,
  peakCount = 9,
  baseY = -0.45,
  maxWorldY = 5.2,
  sunlitColor = '#ff8a3d',
  rimColor = '#ff2fb8',
  shadowColor = '#18d9ff',
  leftFaceColor = '#000000',
  rightFaceColor = '#09070d'
}) {
  const { fillGeo, wireGeo, ridgeGeo, baseGeo } = useMemo(() => {
    const rand = (n) => {
      const x = Math.sin(n * 12.9898 + seed * 78.233) * 43758.5453
      return x - Math.floor(x)
    }

    const warm = new THREE.Color(sunlitColor).multiplyScalar(glow)
    const rim = new THREE.Color(rimColor).multiplyScalar(glow * 0.86)
    const cool = new THREE.Color(shadowColor).multiplyScalar(glow * 0.72)
    const leftFace = new THREE.Color(leftFaceColor)
    const rightFace = new THREE.Color(rightFaceColor)
    const vertices = []
    const fillPositions = []
    const fillColors = []
    const edgePositions = []
    const edgeColors = []
    const ridgePoints = []
    const ridgeColors = []
    const basePoints = []
    const baseColors = []
    const addPoint = (x, y) => {
      vertices.push(x, y, 0)
      return vertices.length / 3 - 1
    }
    const addFace = (a, b, c, isRightFace) => {
      const shade = isRightFace ? rightFace : leftFace
      for (const point of [a, b, c]) {
        fillPositions.push(vertices[point * 3], vertices[point * 3 + 1], -0.02)
        fillColors.push(shade.r, shade.g, shade.b)
      }
    }
    const colorAt = (x, y) => {
      const worldX = position[0] + x
      const worldY = position[1] + y
      const heightLight = THREE.MathUtils.clamp((worldY + 1.1) / 4.4, 0, 1)
      const sunFacing = 1 - THREE.MathUtils.clamp(Math.abs(worldX) / 72, 0, 1)
      const warmth = THREE.MathUtils.clamp(heightLight * 0.72 + sunFacing * 0.46, 0, 1)
      return cool
        .clone()
        .lerp(rim, warmth * 0.52)
        .lerp(warm, warmth * warmth * 0.58)
    }
    const addEdge = (a, b, z = 0.04) => {
      const ax = vertices[a * 3]
      const ay = vertices[a * 3 + 1]
      const bx = vertices[b * 3]
      const by = vertices[b * 3 + 1]
      const colorA = colorAt(ax, ay)
      const colorB = colorAt(bx, by)
      edgePositions.push(ax, ay, z, bx, by, z)
      edgeColors.push(colorA.r, colorA.g, colorA.b, colorB.r, colorB.g, colorB.b)
    }
    const addRidgePoint = (x, y) => {
      const color = colorAt(x, y)
      ridgePoints.push(new THREE.Vector3(x, y, 0.08))
      ridgeColors.push(color.r, color.g, color.b)
    }
    const addBaseEdge = (leftX, rightX) => {
      const leftColor = colorAt(leftX, baseY).multiplyScalar(0.72)
      const rightColor = colorAt(rightX, baseY).multiplyScalar(0.72)
      basePoints.push(new THREE.Vector3(leftX, baseY, 0.02), new THREE.Vector3(rightX, baseY, 0.02))
      baseColors.push(
        leftColor.r,
        leftColor.g,
        leftColor.b,
        rightColor.r,
        rightColor.g,
        rightColor.b
      )
    }

    const span = width / peakCount
    let previousRight = -width / 2

    for (let i = 0; i < peakCount; i++) {
      const cellLeft = -width / 2 + i * span
      const center = cellLeft + span * (0.42 + rand(i * 2.3) * 0.22)
      const halfWidth = span * (0.46 + rand(i * 4.1) * 0.34)
      const leftX = Math.max(-width / 2, Math.min(center - halfWidth, previousRight - span * 0.18))
      const rightX = Math.min(width / 2, center + halfWidth)
      const peakX = THREE.MathUtils.lerp(leftX, rightX, 0.38 + rand(i * 6.7) * 0.24)
      const peakY = Math.min(baseY + height * (0.48 + rand(i * 8.9) * 0.5), maxWorldY - position[1])
      const shoulderY = Math.min(baseY + height * (0.13 + rand(i * 5.4) * 0.18), peakY * 0.58)
      const leftShoulderX = THREE.MathUtils.lerp(leftX, peakX, 0.48 + rand(i * 3.8) * 0.18)
      const rightShoulderX = THREE.MathUtils.lerp(peakX, rightX, 0.42 + rand(i * 7.4) * 0.2)

      const left = addPoint(leftX, baseY + (rand(i * 9.1) - 0.5) * 0.12)
      const leftShoulder = addPoint(leftShoulderX, shoulderY)
      const peak = addPoint(peakX, peakY)
      const rightShoulder = addPoint(rightShoulderX, shoulderY * 0.88 + peakY * 0.12)
      const right = addPoint(rightX, baseY + (rand(i * 10.2) - 0.5) * 0.12)
      const lowerLeft = addPoint(
        THREE.MathUtils.lerp(leftX, peakX, 0.34),
        baseY + height * (0.08 + rand(i * 11.3) * 0.12)
      )
      const lowerMid = addPoint(
        THREE.MathUtils.lerp(leftX, rightX, 0.5),
        baseY + height * (0.1 + rand(i * 12.5) * 0.14)
      )
      const lowerRight = addPoint(
        THREE.MathUtils.lerp(peakX, rightX, 0.62),
        baseY + height * (0.08 + rand(i * 13.7) * 0.12)
      )

      addFace(left, lowerLeft, leftShoulder, false)
      addFace(leftShoulder, lowerLeft, peak, false)
      addFace(lowerLeft, lowerMid, peak, false)
      addFace(peak, lowerMid, rightShoulder, true)
      addFace(rightShoulder, lowerMid, lowerRight, true)
      addFace(rightShoulder, lowerRight, right, true)

      addEdge(left, leftShoulder)
      addEdge(leftShoulder, peak)
      addEdge(peak, rightShoulder)
      addEdge(rightShoulder, right)
      addEdge(left, lowerLeft)
      addEdge(lowerLeft, peak)
      addEdge(lowerMid, peak)
      addEdge(peak, lowerRight)
      addEdge(lowerRight, right)

      if (i % 2 === 0) addEdge(leftShoulder, lowerMid)
      else addEdge(lowerLeft, rightShoulder)

      addRidgePoint(leftX, vertices[left * 3 + 1])
      addRidgePoint(leftShoulderX, shoulderY)
      addRidgePoint(peakX, peakY)
      addRidgePoint(rightShoulderX, vertices[rightShoulder * 3 + 1])
      addRidgePoint(rightX, vertices[right * 3 + 1])
      addBaseEdge(leftX, rightX)
      previousRight = rightX
    }

    const fillGeo = new THREE.BufferGeometry()
    fillGeo.setAttribute('position', new THREE.Float32BufferAttribute(fillPositions, 3))
    fillGeo.setAttribute('color', new THREE.Float32BufferAttribute(fillColors, 3))

    const wireGeo = new THREE.BufferGeometry()
    wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3))
    wireGeo.setAttribute('color', new THREE.Float32BufferAttribute(edgeColors, 3))

    const ridgeGeo = new THREE.BufferGeometry().setFromPoints(ridgePoints)
    ridgeGeo.setAttribute('color', new THREE.Float32BufferAttribute(ridgeColors, 3))
    const baseGeo = new THREE.BufferGeometry().setFromPoints(basePoints)
    baseGeo.setAttribute('color', new THREE.Float32BufferAttribute(baseColors, 3))
    return { fillGeo, wireGeo, ridgeGeo, baseGeo }
  }, [
    seed,
    width,
    height,
    peakCount,
    baseY,
    maxWorldY,
    sunlitColor,
    rimColor,
    shadowColor,
    leftFaceColor,
    rightFaceColor,
    glow,
    position[0],
    position[1]
  ])

  return (
    <group position={position}>
      <mesh geometry={fillGeo}>
        <meshBasicMaterial
          vertexColors
          transparent
          opacity={0.94}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <lineSegments geometry={wireGeo}>
        <lineBasicMaterial
          vertexColors
          transparent
          opacity={opacity * 0.5}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          fog={false}
        />
      </lineSegments>
      <line geometry={ridgeGeo}>
        <lineBasicMaterial
          vertexColors
          transparent
          opacity={opacity}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          fog={false}
        />
      </line>
      <lineSegments geometry={baseGeo}>
        <lineBasicMaterial
          vertexColors
          transparent
          opacity={opacity * 0.24}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          fog={false}
        />
      </lineSegments>
    </group>
  )
}

function DualGrid() {
  const ref = useRef()
  useFrame(({ clock }) => {
    if (ref.current) ref.current.position.z = (clock.getElapsedTime() * 4) % 4
  })
  return (
    <group ref={ref}>
      <primitive
        object={
          new THREE.GridHelper(
            200,
            50,
            new THREE.Color(0.0, 3.0, 3.0),
            new THREE.Color(0.0, 3.0, 3.0)
          )
        }
        position={[0, -1, 0]}
      />
      <primitive
        object={
          new THREE.GridHelper(
            200,
            50,
            new THREE.Color(3.0, 0.0, 1.5),
            new THREE.Color(3.0, 0.0, 1.5)
          )
        }
        position={[0.15, -1.01, 0.15]}
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.05, 0]}>
        <planeGeometry args={[200, 200]} />
        <meshBasicMaterial color="#050014" />
      </mesh>
    </group>
  )
}

function TwinklingStars() {
  const ref = useRef()
  const count = 120
  const [positions, phases] = useMemo(() => {
    const pos = new Float32Array(count * 3)
    const pha = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 160
      pos[i * 3 + 1] = Math.random() * 40 + 5
      pos[i * 3 + 2] = -Math.random() * 30 - 90
      pha[i] = Math.random() * Math.PI * 2
    }
    return [pos, pha]
  }, [])
  useFrame(({ clock }) => {
    if (ref.current) ref.current.material.uniforms.time.value = clock.getElapsedTime()
  })
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={count}
          array={positions}
          itemSize={3}
        />
        <bufferAttribute attach="attributes-phase" count={count} array={phases} itemSize={1} />
      </bufferGeometry>
      <shaderMaterial
        transparent
        depthWrite={false}
        uniforms={{ time: { value: 0 } }}
        vertexShader={`attribute float phase; varying float vAlpha; uniform float time; void main(){vec4 m=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*m;gl_PointSize=1.5*(100.0/-m.z);vAlpha=(sin(time*1.5+phase)+1.0)*0.5;}`}
        fragmentShader={`varying float vAlpha;void main(){if(length(gl_PointCoord-vec2(0.5))>0.5)discard;gl_FragColor=vec4(1.0,1.0,1.0,vAlpha*0.8);}`}
      />
    </points>
  )
}

export default function RetroFutureBackground() {
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
      <Canvas
        camera={{ position: [0, 2, 10], fov: 60 }}
        onCreated={({ gl }) => {
          gl.setClearColor('#0a0022', 1)
          gl.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        }}
      >
        <fog attach="fog" args={['#0a0022', 10, 50]} />
        <TwinklingStars />
        <Sun />
        <WireMountainLayer
          position={[0, -0.58, -44]}
          seed={1.2}
          glow={1.18}
          opacity={0.32}
          height={4.8}
          peakCount={9}
          baseY={-0.35}
          maxWorldY={4.95}
          sunlitColor="#ff7a33"
          rimColor="#ff2fb8"
          shadowColor="#2076ff"
          rightFaceColor="#08050b"
        />
        <WireMountainLayer
          position={[0.08, -0.66, -39]}
          seed={4.8}
          glow={1.9}
          opacity={0.74}
          height={6.25}
          peakCount={10}
          baseY={-0.42}
          maxWorldY={5.45}
          sunlitColor="#ff9348"
          rimColor="#ff35bc"
          shadowColor="#18e3ff"
          rightFaceColor="#0d0811"
        />
        <WireMountainLayer
          position={[-0.35, -0.78, -35]}
          seed={8.4}
          glow={1.35}
          opacity={0.26}
          height={4.45}
          peakCount={8}
          baseY={-0.46}
          maxWorldY={4.85}
          sunlitColor="#ff6d35"
          rimColor="#e82da9"
          shadowColor="#15d4ff"
          rightFaceColor="#07060a"
        />
        <DualGrid />
        <EffectComposer>
          <Bloom luminanceThreshold={0.16} luminanceSmoothing={0.88} intensity={1.25} />
        </EffectComposer>
      </Canvas>
    </div>
  )
}
