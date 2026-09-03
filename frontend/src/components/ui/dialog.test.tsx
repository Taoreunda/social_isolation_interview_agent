import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Dialog, DialogContent, DialogTitle } from './dialog'

describe('Dialog', () => {
  it('localizes its close action and disables decorative motion when requested', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>테스트 대화상자</DialogTitle>
        </DialogContent>
      </Dialog>,
    )

    expect(screen.getByRole('button', { name: '대화상자 닫기' })).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveClass('motion-reduce:animate-none')
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toHaveClass('motion-reduce:animate-none')
  })
})
