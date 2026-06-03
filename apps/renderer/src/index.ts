import express from 'express'
import cors from 'cors'
import renderRouter from './routes/render'

const app = express()
const PORT = process.env.PORT ?? 3001

app.use(cors())
app.use(express.json({ limit: '10mb' }))

app.get('/health', (_req, res) => res.json({ status: 'ok' }))
app.use('/', renderRouter)

app.listen(PORT, () => {
  console.log(`Renderer service running on port ${PORT}`)
})
