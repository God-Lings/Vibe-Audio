import React, { useState, useRef } from 'react'

const TiltCard = React.forwardRef(({ children, className, maxTilt = 12, perspective = 600, showFluidEdge = false, isSpeaking = false }, externalRef) => {
  const localRef = useRef(null)
  const cardRef = externalRef || localRef
  const rafRef = useRef(null)
  const [isHovering, setIsHovering] = useState(false)
  const [rotate, setRotate] = useState({ x: 0, y: 0 })
  const [glare, setGlare] = useState({ x: 50, y: 50, opacity: 0 })

  const handleMouseMove = (e) => {
    if (!cardRef.current) return
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      const rect = cardRef.current.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const centerX = rect.width / 2
      const centerY = rect.height / 2
      const yFactor = y / rect.height
      const damping = yFactor > 0.7 ? 0 : (yFactor > 0.4 ? Math.max(0.1, 1 - (yFactor - 0.4) * 1.5) : 1)
      const rotateX = ((y - centerY) / centerY) * -maxTilt * damping
      const rotateY = ((x - centerX) / centerX) * maxTilt
      setRotate({ x: rotateX, y: rotateY })
      setGlare({ x: (x / rect.width) * 100, y: (y / rect.height) * 100, opacity: 1 })
    })
  }

  const handleMouseEnter = () => setIsHovering(true)

  const handleMouseLeave = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    setIsHovering(false)
    setRotate({ x: 0, y: 0 })
    setGlare({ x: 50, y: 50, opacity: 0 })
  }

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        transform: `perspective(${perspective}px) rotateX(${rotate.x}deg) rotateY(${rotate.y}deg)`,
        transition: isHovering ? 'none' : 'transform 0.4s cubic-bezier(0.23, 1, 0.32, 1)'
      }}
      className={`relative ${className}`}
    >
      {showFluidEdge && (
        <div
          className={`absolute -inset-[2px] rounded-[42px] animate-spin-gradient blur-[8px] mix-blend-screen pointer-events-none transition-opacity duration-700 ${isSpeaking ? 'opacity-85' : 'opacity-25'}`}
          style={{ zIndex: -2 }}
        />
      )}

      {showFluidEdge && (
        <div className="absolute inset-0 bg-[#121212]/95 backdrop-blur-3xl rounded-[40px] border border-white/5 pointer-events-none" style={{ zIndex: -1 }}></div>
      )}

      <div
        className="absolute inset-0 pointer-events-none transition-opacity duration-300 rounded-[inherit]"
        style={{
          opacity: glare.opacity,
          background: `radial-gradient(circle at ${glare.x}% ${glare.y}%, rgba(255,255,255,0.06) 0%, transparent 60%)`,
          zIndex: 50
        }}
      />

      {children}
    </div>
  )
})

export default TiltCard
