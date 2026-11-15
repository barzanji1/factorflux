import { collectionEventFields } from "@/lib/collection-event-details";

/** Read-only presentation: never changes or truncates the stored event payload. */
export function CollectionEventDetails({ details }: { details: unknown }) {
  if (details === null || details === undefined) return null;
  return (
    <details className="mt-2 min-w-0" data-testid="collection-event-details">
      <summary className="cursor-pointer font-bold text-[#168d99]">Event details</summary>
      <dl className="mt-2 space-y-2 rounded-lg p-3 text-xs">
        {collectionEventFields(details).map((field, index) => (
          <div key={index} className="grid min-w-0 gap-1 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)] sm:gap-3">
            <dt className="font-semibold text-[#555] [overflow-wrap:anywhere]">{field.label}</dt>
            <dd className="min-w-0 whitespace-pre-wrap text-[#333] [overflow-wrap:anywhere]">{field.value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
