export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; error?: string }>;
}) {
  const params = await searchParams;
  const redirectTo = params.redirect && params.redirect.startsWith("/") ? params.redirect : "/";

  return (
    <div className="flex flex-1 items-center justify-center bg-background p-6">
      <div className="hero-gradient w-full max-w-sm rounded-2xl p-8 text-white shadow-sm">
        <h1 className="text-xl font-semibold">Meeting Translator</h1>
        <p className="mt-1 text-sm text-white/85">Enter the password to continue.</p>

        <form method="POST" action="/api/login" className="mt-6 flex flex-col gap-3">
          <input type="hidden" name="redirect" value={redirectTo} />
          <input
            type="password"
            name="password"
            autoFocus
            required
            placeholder="Password"
            className="rounded-lg border border-white/30 bg-white/10 px-3 py-2 text-white placeholder-white/60 outline-none focus:border-white"
          />
          {params.error && <p className="text-sm text-red-100">Incorrect password. Try again.</p>}
          <button
            type="submit"
            className="rounded-full bg-white px-4 py-2 text-sm font-medium text-[#111439] transition-opacity hover:opacity-90"
          >
            Continue
          </button>
        </form>
      </div>
    </div>
  );
}
