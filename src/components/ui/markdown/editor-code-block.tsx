/**
 * @file A block of code in the editor: the same box and caption as where a
 * text is read, with the code coloured while it's written. The language is
 * picked in the toolbar, or typed after the three backticks that start the
 * block.
 */
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import {
  NodeViewContent,
  NodeViewWrapper,
  type ReactNodeViewProps,
  ReactNodeViewRenderer,
} from '@tiptap/react';

import { editorHighlighter, useCodeLanguages } from './editor-highlighter';
import { markdownStyles } from './styles';

/**
 * The block as it's shown: a caption with the language's name (as it was
 * written until the names have loaded, the given caption without a
 * language), then the code, left to right. The caption isn't part of the text.
 *
 * @param props - What the editor passes a node's view, and the caption.
 * @param props.node - The block.
 * @param props.codeLabel - The caption of a block that names no language ("Code").
 * @returns The block.
 */
function CodeBlockView({ node, codeLabel }: ReactNodeViewProps & { codeLabel: string }) {
  const languages = useCodeLanguages();
  const language: unknown = node.attrs.language;
  const caption =
    typeof language === 'string' && language
      ? (languages?.nameOf(language) ?? language)
      : codeLabel;
  return (
    <NodeViewWrapper as="figure" className={markdownStyles.codeFigure}>
      <figcaption contentEditable={false} className={markdownStyles.codeCaption}>
        {caption}
      </figcaption>
      <pre dir="ltr" className={markdownStyles.editorCode}>
        <NodeViewContent<'code'> as="code" />
      </pre>
    </NodeViewWrapper>
  );
}

/**
 * Builds the editor's block of code: highlighted by {@link editorHighlighter}
 * (which never guesses a language), and shown by {@link CodeBlockView}.
 *
 * @param codeLabel - The caption of a block that names no language.
 * @returns The extension.
 */
export default function editorCodeBlock(codeLabel: string) {
  /**
   * The block's view, with its caption.
   *
   * @param props - What the editor passes a node's view.
   * @returns The block.
   */
  function View(props: ReactNodeViewProps) {
    return <CodeBlockView {...props} codeLabel={codeLabel} />;
  }
  return CodeBlockLowlight.extend({
    /**
     * How a block is shown.
     *
     * @returns The React view.
     */
    addNodeView() {
      return ReactNodeViewRenderer(View);
    },
  }).configure({ lowlight: editorHighlighter, defaultLanguage: null });
}
