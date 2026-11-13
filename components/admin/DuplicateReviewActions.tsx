/**
 * Confirm / reject buttons for one duplicate suggestion on
 * /admin/duplicates. The decision is enforced server-side in
 * reviewDuplicateSuggestion (moderator/admin only); confirming
 * records the decision and never closes anything automatically.
 */
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "../ui/button";
import { reviewDuplicateSuggestion } from "@/lib/actions/duplicate-suggestion.action";

const DuplicateReviewActions = ({
  suggestionId,
}: {
  suggestionId: string;
}) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"confirmed" | "rejected" | null>(null);

  const review = (decision: "confirmed" | "rejected") => {
    setError(null);
    startTransition(async () => {
      const result = await reviewDuplicateSuggestion({
        suggestionId,
        decision,
      });
      if (result.success) {
        setDone(decision);
        router.refresh();
      } else {
        setError(result.error ?? "Review failed. Please try again.");
      }
    });
  };

  if (done) {
    return (
      <p className="small-regular text-light-500">
        {done === "confirmed"
          ? "Confirmed as a duplicate — decision recorded."
          : "Rejected — removed from the queue."}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        className="primary-gradient w-fit"
        onClick={() => review("confirmed")}
        disabled={isPending}
      >
        Confirm duplicate
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={() => review("rejected")}
        disabled={isPending}
      >
        Not a duplicate
      </Button>
      {error && <p className="body-regular text-red-500">{error}</p>}
    </div>
  );
};

export default DuplicateReviewActions;
