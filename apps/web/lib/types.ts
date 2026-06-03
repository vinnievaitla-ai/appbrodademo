export type Category = 'hook' | 'body' | 'text' | 'audio' | 'end_card'

export interface Template {
  id: string
  name: string
  file_url: string
  file_size_bytes: number
  category: Category
  created_at: string
}

export interface RenderJob {
  id: string
  template_id: string | null
  prompt: string
  status: 'pending' | 'processing' | 'done' | 'failed'
  output_url: string | null
  error_message: string | null
  created_at: string
  completed_at: string | null
}
