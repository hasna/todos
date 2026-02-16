export function LegalPage() {
  return (
    <div className="max-w-3xl space-y-8">
      <h2 className="text-lg font-semibold">Legal</h2>

      <section className="space-y-3">
        <h3 className="text-base font-semibold">License</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          todos.md is released under the{" "}
          <a
            href="https://github.com/hasna/open-todos/blob/main/LICENSE"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4 hover:text-foreground"
          >
            MIT License
          </a>
          . You are free to use, modify, and distribute it for any purpose.
        </p>
      </section>

      <div className="border-t" />

      <section className="space-y-3">
        <h3 className="text-base font-semibold">Privacy</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          todos.md is a local-first application. All data is stored on your machine in a
          SQLite database. No data is sent to any external server unless you explicitly
          use the sync feature with a configured agent.
        </p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          The web dashboard runs on localhost and does not collect analytics, telemetry,
          or any form of user tracking.
        </p>
      </section>

      <div className="border-t" />

      <section className="space-y-3">
        <h3 className="text-base font-semibold">Third-Party Dependencies</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          todos.md uses open-source libraries including Bun, SQLite, React, Tailwind CSS,
          and the Model Context Protocol SDK. Each dependency is subject to its own license terms.
        </p>
      </section>
    </div>
  );
}
