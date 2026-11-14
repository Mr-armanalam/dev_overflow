/**
 * /admin/duplicates — moderator duplicate-review queue (design §7.2, P3).
 *
 * Lists AI duplicate suggestions awaiting review. Moderator/admin only
 * (requirePermissionForPage: sign-in redirect, 404 for the wrong role).
 *
 * Confirming records the decision only — it never closes, deletes or
 * redirects anything. Rejecting removes the row from the queue.
 */
import Link from "next/link";
import { requirePermissionForPage } from "@/lib/auth/server-permissions";
import { getPendingDuplicateSuggestions } from "@/lib/actions/duplicate-suggestion.action";
import DuplicateReviewActions from "@/components/admin/DuplicateReviewActions";

const AdminDuplicatesPage = async () => {
  // Moderator/admin only: redirects to sign-in when signed out,
  // 404s otherwise.
  await requirePermissionForPage("ai:duplicate:confirm");

  const result = await getPendingDuplicateSuggestions();
  const suggestions = result.suggestions ?? [];

  return (
    <div>
      <h1 className="h1-bold text-dark100_light900">Duplicate review</h1>
      <p className="body-regular mt-2 text-light-500">
        AI duplicate suggestions awaiting review. Confirming records your
        decision — it never closes a question automatically. Rejecting
        removes the suggestion from this queue.
      </p>

      {!result.success && (
        <p className="body-regular mt-6 text-red-500">
          {result.error ?? "Could not load duplicate suggestions."}
        </p>
      )}

      {result.success && suggestions.length === 0 && (
        <p className="body-regular mt-6 text-light-500">
          No duplicate suggestions awaiting review.
        </p>
      )}

      {suggestions.length > 0 && (
        <div className="mt-8 space-y-4">
          {suggestions.map((suggestion) => (
            <div
              key={suggestion.id}
              className="background-light900_dark300 light-border rounded-md border p-4"
            >
              <p className="paragraph-semibold text-dark100_light900">
                {suggestion.draftTitle}
              </p>
              {suggestion.draftBody && (
                <p className="body-regular mt-1 line-clamp-2 text-light-500">
                  {suggestion.draftBody}
                </p>
              )}
              <p className="body-regular mt-3 text-dark400_light800">
                Looks like a duplicate of{" "}
                <Link
                  href={`/question/${suggestion.duplicateOfId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-500 hover:underline"
                >
                  {suggestion.duplicateOfTitle}
                </Link>{" "}
                — confidence {Math.round(suggestion.confidence * 100)}%
              </p>
              <p className="small-regular mt-1 text-light-500">
                {suggestion.reason}
              </p>
              <p className="small-regular mt-2 text-light-500">
                Suggested by {suggestion.suggestedByUsername} on{" "}
                {new Date(suggestion.createdAt).toLocaleString()}
                {suggestion.questionId && (
                  <>
                    {" · "}
                    <Link
                      href={`/question/${suggestion.questionId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary-500 hover:underline"
                    >
                      View submitted question
                      {suggestion.questionTitle
                        ? ` (${suggestion.questionTitle})`
                        : ""}
                    </Link>
                  </>
                )}
              </p>
              <div className="mt-4">
                <DuplicateReviewActions suggestionId={suggestion.id} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminDuplicatesPage;
