import { z } from 'zod'

const unit = z.number().min(0).max(1)

const faceBoxSchema = z.object({ x: unit, y: unit, w: unit, h: unit })

export type FaceBox = z.infer<typeof faceBoxSchema>
