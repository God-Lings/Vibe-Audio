import { useState, useEffect, useRef } from 'react'

export default function TypewriterText({ text }) {
  const [displayed, setDisplayed] = useState('')
  const [done, setDone] = useState(false)
  const idxRef = useRef(0)

  useEffect(() => {
    idxRef.current = 0
    setDisplayed('')
    setDone(false)
  }, [text])

  useEffect(() => {
    if (done || !text) return
    const timer = setInterval(() => {
      const next = idxRef.current + 1
      if (next >= text.length) {
        setDisplayed(text)
        setDone(true)
        clearInterval(timer)
      } else {
        idxRef.current = next
        setDisplayed(text.slice(0, next))
      }
    }, 50)
    return () => clearInterval(timer)
  }, [text, done])

  return (
    <span>
      {displayed || ''}
      {!done && <span className="inline-block w-[2px] h-[11px] bg-[#1DB954] ml-0.5 animate-pulse align-middle"></span>}
    </span>
  )
}
