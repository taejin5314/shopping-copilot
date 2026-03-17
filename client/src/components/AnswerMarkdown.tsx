import ReactMarkdown from "react-markdown";

interface Props {
  children: string;
}

/**
 * Renders backend answer text as polished rich text.
 * Uses react-markdown with no unsafe HTML — all content is sanitized by default.
 */
export default function AnswerMarkdown({ children }: Props) {
  if (!children) return null;
  return (
    <div className="answer-md">
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  );
}
