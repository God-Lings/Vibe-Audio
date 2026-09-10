import { useState, useEffect, useRef } from 'react'

const chars = '!<>-_\\/[]{}—=+*^?#促山产人今他以个来水看是然大时很编码系统矩阵流光频段'

export default function ScrambleText({ text, className }) {
  const [displayText, setDisplayText] = useState(text)
  const prevTextRef = useRef(text)

  useEffect(() => {
    if (prevTextRef.current === text) return
    prevTextRef.current = text
    if (!text) return

    let iteration = 0
    const interval = setInterval(() => {
      setDisplayText(() =>
        text.split('').map((letter, index) => {
          if (index < iteration) return text[index]
          return chars[Math.floor(Math.random() * chars.length)]
        }).join('')
      )
      if (iteration >= text.length) clearInterval(interval)
      iteration += 1 / 3
    }, 30)

    return () => clearInterval(interval)
  }, [text])

  return <span className={className}>{displayText}</span>
}
