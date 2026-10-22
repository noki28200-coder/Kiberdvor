import Markdown from 'react-markdown';
import { useParams } from 'react-router';
import remarkGfm from 'remark-gfm';
import consent from '../../../../docs/legal/pd-consent.md?raw';
import offer from '../../../../docs/legal/offer.md?raw';
import privacy from '../../../../docs/legal/privacy-policy.md?raw';
import terms from '../../../../docs/legal/terms.md?raw';

const DOCS: Record<string, string> = { privacy, consent, terms, offer };

export function LegalPage() {
  const { doc = '' } = useParams();
  const text = DOCS[doc];
  if (!text) return <p>Документ не найден.</p>;
  return (
    <article className="legal">
      <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
    </article>
  );
}
