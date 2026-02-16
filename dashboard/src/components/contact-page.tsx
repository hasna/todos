import { MailIcon, GithubIcon } from "lucide-react";

export function ContactPage() {
  return (
    <div className="max-w-3xl space-y-8">
      <h2 className="text-lg font-semibold">Contact</h2>

      <p className="text-muted-foreground">
        Reach out and we&apos;ll make sure you talk to the right person.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border p-6 space-y-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-950">
              <GithubIcon className="size-4 text-blue-600 dark:text-blue-400" />
            </div>
            <h3 className="text-sm font-semibold">Create a GitHub issue</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Report a bug, request an improvement, or track roadmap updates directly
            in the public repository.
          </p>
          <a
            href="https://github.com/hasna/open-todos/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent transition-colors"
          >
            Create an issue
            <span className="text-xs">&nearr;</span>
          </a>
        </div>

        <div className="rounded-lg border p-6 space-y-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-green-100 dark:bg-green-950">
              <MailIcon className="size-4 text-green-600 dark:text-green-400" />
            </div>
            <h3 className="text-sm font-semibold">Email</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Questions about integration, features, or partnerships? Send us an email
            and we&apos;ll get back to you.
          </p>
          <a
            href="mailto:hasna@todos.md"
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent transition-colors"
          >
            hasna@todos.md
            <span className="text-xs">&nearr;</span>
          </a>
        </div>
      </div>
    </div>
  );
}
