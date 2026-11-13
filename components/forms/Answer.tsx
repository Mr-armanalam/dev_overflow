/* eslint-disable spaced-comment */
/* eslint-disable no-useless-return */
"use client";
import React, { useEffect, useState } from "react";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "../ui/form";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AnserSchema } from "@/lib/validation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Editor } from "@tinymce/tinymce-react";
import type { Editor as TinyMCEEditor } from "tinymce";
import { useTheme } from "@/context/ThemeProvider";
import { Button } from "../ui/button";
import Image from "next/image";
import { createAnswer } from "@/lib/actions/answer.action";
import { recordAiFeedback } from "@/lib/actions/ai.action";
import { usePathname } from "next/navigation";
import Link from "next/link";
import ParseHTML from "../shared/ParseHTML";
import { renderAiMarkdown } from "@/lib/ai/markdown";
import { ThumbsDown, ThumbsUp } from "lucide-react";

interface Props {
  questionId: string;
}

/** One RAG source, from the `x-ai-sources` response header of
 *  /api/ai/draft. `n` matches the [n] citation markers in the draft. */
interface AiSource {
  n: number;
  questionId: string;
  title: string;
  score: number;
}

// NOTE: the author is derived from the Clerk session inside
// createAnswer — the form no longer sends a user id.
// NOTE: the form no longer takes the question text as a prop — the
// /api/ai/draft route loads the question from the database by id, so
// the client can never smuggle different content into the prompt.
const Answer = ({ questionId }: Props) => {
  const pathname = usePathname();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmittingAI, setIsSubmittingAI] = useState(false);

  // AI draft panel state. The draft is Markdown streamed from
  // /api/ai/draft; it only reaches the editor when the user presses
  // "Insert into editor", and only reaches the site when they press
  // Submit — AI output is never auto-published.
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiDraftMarkdown, setAiDraftMarkdown] = useState("");
  const [aiDraftHtml, setAiDraftHtml] = useState("");
  const [aiDraftReady, setAiDraftReady] = useState(false);
  const [aiDraftInserted, setAiDraftInserted] = useState(false);
  const [aiAssisted, setAiAssisted] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiUsageLogId, setAiUsageLogId] = useState<string | null>(null);
  const [aiSources, setAiSources] = useState<AiSource[]>([]);
  const [aiFeedback, setAiFeedback] = useState<
    "helpful" | "not_helpful" | null
  >(null);
  const aiRenderSeq = React.useRef(0);

  const { mode } = useTheme();
  const editorRef = React.useRef<TinyMCEEditor | null>(null);
  const form = useForm<z.infer<typeof AnserSchema>>({
    resolver: zodResolver(AnserSchema),
    defaultValues: {
      answer: "",
    },
  }); // follow sadcn

  // Render the streaming Markdown preview as sanitised HTML. A sequence
  // guard drops stale renders when chunks arrive faster than marked.
  useEffect(() => {
    if (!aiDraftMarkdown) {
      setAiDraftHtml("");
      return;
    }
    const seq = ++aiRenderSeq.current;
    let cancelled = false;
    renderAiMarkdown(aiDraftMarkdown).then((html) => {
      if (!cancelled && seq === aiRenderSeq.current) {
        setAiDraftHtml(html);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [aiDraftMarkdown]);

  const resetAiState = () => {
    setShowAiPanel(false);
    setAiDraftMarkdown("");
    setAiDraftHtml("");
    setAiDraftReady(false);
    setAiDraftInserted(false);
    setAiAssisted(false);
    setAiError(null);
    setAiUsageLogId(null);
    setAiSources([]);
    setAiFeedback(null);
  };

  const handleCreateAnswer = async (values: z.infer<typeof AnserSchema>) => {
    setIsSubmitting(true);

    try {
      await createAnswer({
        content: values.answer,
        question: JSON.parse(questionId),
        path: pathname,
        aiAssisted,
      });

      form.reset();
      resetAiState();

      if (editorRef.current) {
        editorRef.current.setContent("");
      }
    } catch (error) {
      console.log(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const generateAIAnswer = async () => {
    setIsSubmittingAI(true);
    setAiError(null);
    setAiDraftMarkdown("");
    setAiDraftHtml("");
    setAiDraftReady(false);
    setAiDraftInserted(false);
    setAiFeedback(null);
    setAiUsageLogId(null);
    setAiSources([]);
    setShowAiPanel(true);

    try {
      const response = await fetch("/api/ai/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: JSON.parse(questionId) }),
      });

      if (!response.ok) {
        const data: unknown = await response.json().catch(() => null);
        const message =
          (data as { error?: string } | null)?.error ??
          "AI draft failed. Please try again.";
        setAiError(message);
        return;
      }

      const usageLogId = response.headers.get("x-ai-usage-log-id");
      if (usageLogId) {
        setAiUsageLogId(usageLogId);
      }

      // RAG sources (P2): URI-encoded JSON in the `x-ai-sources`
      // header; the [n] numbers match the citation markers in the draft.
      const sourcesHeader = response.headers.get("x-ai-sources");
      if (sourcesHeader) {
        try {
          const parsed: unknown = JSON.parse(
            decodeURIComponent(sourcesHeader)
          );
          if (Array.isArray(parsed)) {
            setAiSources(
              parsed.filter(
                (item): item is AiSource =>
                  typeof item === "object" &&
                  item !== null &&
                  typeof (item as AiSource).n === "number" &&
                  typeof (item as AiSource).questionId === "string" &&
                  typeof (item as AiSource).title === "string"
              )
            );
          }
        } catch {
          // A malformed header must not take the draft away.
          setAiSources([]);
        }
      }

      const reader = response.body?.getReader();
      if (!reader) {
        setAiError("Streaming is not supported in this browser.");
        return;
      }

      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        setAiDraftMarkdown((prev) =>
          prev + decoder.decode(value, { stream: true })
        );
      }
      setAiDraftMarkdown((prev) => prev + decoder.decode());
      setAiDraftReady(true);
    } catch (error) {
      console.log(error);
      setAiError("AI draft failed. Please try again.");
    } finally {
      setIsSubmittingAI(false);
    }
  };

  const insertAiDraftIntoEditor = async () => {
    const html =
      aiDraftHtml || (await renderAiMarkdown(aiDraftMarkdown));
    if (editorRef.current) {
      // renderAiMarkdown already sanitises with DOMPurify.
      editorRef.current.setContent(html);
    }
    // TinyMCE's programmatic setContent does not reliably fire the
    // change handler, so set the form value explicitly too.
    form.setValue("answer", html);
    setAiAssisted(true);
    setAiDraftInserted(true);
  };

  const handleAiFeedback = async (feedback: "helpful" | "not_helpful") => {
    if (!aiUsageLogId || aiFeedback) return;
    setAiFeedback(feedback);
    const result = await recordAiFeedback({
      usageLogId: aiUsageLogId,
      feedback,
    });
    if (!result.success) {
      // The vote is a nice-to-have: don't take the draft away if the
      // save failed, just let the user try again.
      setAiFeedback(null);
    }
  };

  return (
    <div>
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center sm:gap-2">
        <h4 className="paragraph-semibold text-dark400_light800">
          Write your answer here
        </h4>

        <button
          className="btn light-border-2 flex items-center gap-1.5 rounded-md px-4 py-2.5 
        text-primary-500 shadow-none dark:text-primary-500"
          onClick={generateAIAnswer}
          disabled={isSubmittingAI}
        >
          {isSubmittingAI ? (
            <>Generating...</>
          ) : (
            <>
              <Image
                src={"/assets/icons/stars.svg"}
                alt="star"
                width={12}
                height={12}
                className="object-contain"
              />
              Generate AI Answer
            </>
          )}
        </button>
      </div>

      {showAiPanel && (
        <div className="background-light900_dark300 light-border-2 mt-6 rounded-md border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="small-medium text-dark400_light800">
              AI draft — review before posting
            </p>
            <span className="flex items-center gap-1 rounded-md bg-primary-500/10 px-2 py-0.5 text-xs font-medium text-primary-500">
              <Image
                src={"/assets/icons/stars.svg"}
                alt=""
                width={12}
                height={12}
                className="object-contain"
              />
              Gemini 2.5 Flash
            </span>
          </div>

          {isSubmittingAI && !aiDraftMarkdown && (
            <p className="body-regular mt-3 text-light-500">
              Generating draft…
            </p>
          )}
          {aiDraftHtml && (
            <div className="mt-3">
              <ParseHTML data={aiDraftHtml} />
            </div>
          )}
          {aiDraftReady && aiSources.length > 0 && (
            <div className="mt-4">
              <p className="small-medium text-dark400_light800">Sources</p>
              <ul className="mt-2 space-y-1">
                {aiSources.map((source) => (
                  <li key={source.questionId}>
                    <Link
                      href={`/question/${source.questionId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="body-regular text-primary-500 hover:underline"
                    >
                      [{source.n}] {source.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {aiError && (
            <p className="body-regular mt-3 text-red-500">{aiError}</p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              className="primary-gradient w-fit"
              onClick={insertAiDraftIntoEditor}
              disabled={!aiDraftReady || aiDraftInserted}
            >
              {aiDraftInserted
                ? "Inserted into editor"
                : "Insert into editor"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={generateAIAnswer}
              disabled={isSubmittingAI}
            >
              Regenerate
            </Button>
            {aiUsageLogId && aiDraftReady && (
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Draft was helpful"
                  onClick={() => handleAiFeedback("helpful")}
                  disabled={aiFeedback !== null}
                  className={`rounded-md p-2 hover:bg-light-800 dark:hover:bg-dark-400 ${
                    aiFeedback === "helpful"
                      ? "text-primary-500"
                      : "text-light-500"
                  }`}
                >
                  <ThumbsUp size={16} />
                </button>
                <button
                  type="button"
                  aria-label="Draft was not helpful"
                  onClick={() => handleAiFeedback("not_helpful")}
                  disabled={aiFeedback !== null}
                  className={`rounded-md p-2 hover:bg-light-800 dark:hover:bg-dark-400 ${
                    aiFeedback === "not_helpful"
                      ? "text-primary-500"
                      : "text-light-500"
                  }`}
                >
                  <ThumbsDown size={16} />
                </button>
                {aiFeedback && (
                  <span className="small-regular text-light-500">
                    Thanks for your feedback
                  </span>
                )}
              </div>
            )}
          </div>

          {aiDraftInserted && (
            <p className="small-regular mt-2 text-light-500">
              Draft inserted — edit it in the editor, then submit. This
              answer will be marked AI-assisted and earns no reputation.
            </p>
          )}
        </div>
      )}

      <Form {...form}>
        <form
          className="mt-6 flex w-full flex-col gap-10"
          onSubmit={form.handleSubmit(handleCreateAnswer)}
        >
          <FormField
            control={form.control}
            name="answer"
            render={({ field }) => (
              <FormItem className="flex w-full flex-col gap-3">
                <FormControl className="mt-3.5">
                  <Editor
                    apiKey={process.env.NEXT_PUBLIC_tINY_EDITOR_API_KEY}
                    onInit={(_evt, editor) => {
                      editorRef.current = editor;
                    }}
                    onBlur={field.onBlur}
                    onEditorChange={(content) => field.onChange(content)}
                    init={{
                      height: 350,
                      menubar: false,
                      plugins: [
                        "advlist",
                        "autolink",
                        "lists",
                        "link",
                        "image",
                        "charmap",
                        "anchor",
                        "codesample",
                        "searchreplace",
                        "visualblocks",
                        "fullscreen",
                        "insertdatetime",
                        "media",
                        "table",
                        "preview",
                        "wordcount",
                      ],
                      toolbar:
                        "undo redo | " +
                        "bold codesample italic forecolor | alignleft aligncenter " +
                        "alignright alignjustify | bullist numlist outdent indent | ",
                      content_style:
                        "body { font-family:Inter; font-size:16px }",
                      skin: mode === "dark" ? "oxide-dark" : "oxide",
                      content_css: mode === "dark" ? "dark" : "light",
                    }}
                  />
                  {/* todo add an editor component */}
                </FormControl>
                <FormMessage className="text-red-900" />
              </FormItem>
            )}
          />
          <div className="mt-4 flex justify-end text-white">
            <Button
              type="submit"
              className="primary-gradient w-fit"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Submitting..." : "Submit"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
};

export default Answer;
