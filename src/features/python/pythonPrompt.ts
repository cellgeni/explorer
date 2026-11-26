import {
  autocompletion,
  startCompletion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentMore,
  insertNewlineAndIndent,
} from '@codemirror/commands'
import { python } from '@codemirror/lang-python'
import {
  bracketMatching,
  defaultHighlightStyle,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language'
import { EditorState, Prec } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'

// The Python console's prompt (plan 29-D11): CodeMirror with Python
// highlighting. Enter runs an input Python finds complete and adds a line
// to one that is not; Shift+Enter always adds a line. Up on the first line
// and Down on the last walk the history. Tab completes, or indents at the
// start of a line.

export interface PythonPromptHandlers {
  // Runs the input: 'incomplete' when Python wants more lines.
  readonly onSubmit: (code: string) => Promise<'done' | 'incomplete'>
  // The history entry before (-1) or after (1) the one shown, or null.
  readonly onHistory: (direction: -1 | 1, current: string) => string | null
  // Completions, and where the text they replace starts.
  readonly complete: (
    code: string,
    cursor: number,
  ) => Promise<{ readonly from: number; readonly items: readonly string[] }>
}

export interface PythonPrompt {
  readonly focus: () => void
  readonly insertAtCursor: (text: string) => void
  readonly setText: (text: string) => void
  readonly text: () => string
  readonly destroy: () => void
}

export function createPythonPrompt(
  parent: HTMLElement,
  handlers: PythonPromptHandlers,
  label: string,
): PythonPrompt {
  let view: EditorView | null = null

  const setText = (text: string) => {
    if (view === null) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      selection: { anchor: text.length },
      scrollIntoView: true,
    })
  }

  const submit = (target: EditorView): boolean => {
    const code = target.state.doc.toString()
    void handlers.onSubmit(code).then((outcome) => {
      if (view !== target) return
      if (outcome === 'incomplete') insertNewlineAndIndent(target)
      else setText('')
    })
    return true
  }

  const walkHistory = (target: EditorView, direction: -1 | 1): boolean => {
    const { state } = target
    const line = state.doc.lineAt(state.selection.main.head)
    const edge = direction === -1 ? line.number === 1 : line.number === state.doc.lines
    if (!edge || !state.selection.main.empty) return false
    const text = handlers.onHistory(direction, state.doc.toString())
    if (text === null) return false
    setText(text)
    return true
  }

  const completeOrIndent = (target: EditorView): boolean => {
    const { state } = target
    const head = state.selection.main.head
    const line = state.doc.lineAt(head)
    if (state.sliceDoc(line.from, head).trim() === '') return indentMore(target)
    return startCompletion(target)
  }

  const source = async (context: CompletionContext): Promise<CompletionResult | null> => {
    if (!context.explicit) return null
    const { from, items } = await handlers.complete(
      context.state.doc.toString(),
      context.pos,
    )
    if (items.length === 0) return null
    return { from, options: items.map((item) => ({ label: item })) }
  }

  view = new EditorView({
    parent,
    state: EditorState.create({
      extensions: [
        Prec.high(
          keymap.of([
            { key: 'Enter', run: submit },
            { key: 'Shift-Enter', run: insertNewlineAndIndent },
            { key: 'ArrowUp', run: (target) => walkHistory(target, -1) },
            { key: 'ArrowDown', run: (target) => walkHistory(target, 1) },
            { key: 'Tab', run: completeOrIndent },
          ]),
        ),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        python(),
        indentUnit.of('    '),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        bracketMatching(),
        autocompletion({ override: [source], activateOnTyping: false }),
        placeholder('Python, such as len(cells)'),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          'aria-label': label,
          'aria-multiline': 'true',
        }),
      ],
    }),
  })

  return {
    focus: () => {
      view?.focus()
    },
    insertAtCursor: (text) => {
      if (view === null) return
      const { from, to } = view.state.selection.main
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
        scrollIntoView: true,
      })
      view.focus()
    },
    setText,
    text: () => view?.state.doc.toString() ?? '',
    destroy: () => {
      view?.destroy()
      view = null
    },
  }
}
