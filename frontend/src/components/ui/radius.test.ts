import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const source = (file: string) => readFile(new URL(file, import.meta.url), 'utf8')

describe('shadcn control radii', () => {
  it('resolves every shared control radius to eight pixels', async () => {
    const [styles, button, input, textarea, checkbox, dialog] = await Promise.all([
      source('../../styles.css'),
      source('./button.tsx'),
      source('./input.tsx'),
      source('./textarea.tsx'),
      source('./checkbox.tsx'),
      source('./dialog.tsx'),
    ])

    expect(styles).toContain('--radius-xs: 8px;')
    expect(styles).toContain('--radius-md: 8px;')
    expect(styles).toContain('--radius-lg: 8px;')
    expect(button).toContain('rounded-md')
    expect(input).toContain('rounded-md')
    expect(textarea).toContain('rounded-md')
    expect(checkbox).toContain('rounded-md')
    expect(checkbox).not.toContain('rounded-[4px]')
    expect(dialog).toContain('rounded-xs')
    expect(dialog).toContain('rounded-lg')
  })
})
