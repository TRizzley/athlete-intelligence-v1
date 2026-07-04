import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — The Operating System for Human Performance",
  description: "Privacy policy for The Operating System for Human Performance app.",
};

export default function PrivacyPage() {
  const lastUpdated = "June 13, 2026";
  const appName = "The Operating System for Human Performance";
  const contactEmail = "tylernewton2024@gmail.com";

  return (
    <main className="min-h-screen bg-[#0A0C10] text-gray-200 px-6 py-16">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-2">{appName}</h1>
        <p className="text-sm text-gray-500 mb-10">Privacy Policy · Last updated {lastUpdated}</p>

        <section className="mb-8">
          <h2 className="text-lg font-semibold text-white mb-3">Overview</h2>
          <p className="text-gray-400 leading-relaxed">
            {appName} (&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) is a personal performance coaching app that
            aggregates data from your connected fitness devices and services to provide
            personalized training recommendations. This policy explains what data we collect,
            how we use it, and your rights around it.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-semibold text-white mb-3">Data We Collect</h2>
          <p className="text-gray-400 leading-relaxed mb-3">
            We collect data only from services you explicitly connect to the app. This may include:
          </p>
          <ul className="list-disc list-inside text-gray-400 space-y-1 leading-relaxed">
            <li>WHOOP: recovery scores, sleep data, strain, heart rate, and workouts</li>
            <li>Account information: your name and email address used to create your account</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-semibold text-white mb-3">How We Use Your Data</h2>
          <ul className="list-disc list-inside text-gray-400 space-y-1 leading-relaxed">
            <li>To generate personalized training and recovery recommendations</li>
            <li>To display your historical trends and performance metrics</li>
            <li>To improve coaching accuracy over time based on your history</li>
          </ul>
          <p className="text-gray-400 leading-relaxed mt-3">
            We do not sell your data to third parties. We do not use your data for advertising.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-semibold text-white mb-3">Data Storage & Security</h2>
          <p className="text-gray-400 leading-relaxed">
            Your data is stored securely using Supabase, a SOC 2 Type II compliant database
            provider. OAuth tokens used to access your connected services are encrypted at rest.
            We access your third-party data only to provide the app&apos;s core functionality.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-semibold text-white mb-3">Third-Party Services</h2>
          <p className="text-gray-400 leading-relaxed">
            When you connect a third-party service (e.g. WHOOP), you authorize us to
            access your data from that service on your behalf using OAuth 2.0. You can revoke
            this access at any time either from within the app or from the connected service&apos;s
            own settings.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-semibold text-white mb-3">Your Rights</h2>
          <ul className="list-disc list-inside text-gray-400 space-y-1 leading-relaxed">
            <li>You can disconnect any service from the app at any time</li>
            <li>You can request deletion of all your data by contacting us</li>
            <li>You can request a copy of your stored data at any time</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-semibold text-white mb-3">Contact</h2>
          <p className="text-gray-400 leading-relaxed">
            Questions about this policy? Email us at{" "}
            <a
              href={`mailto:${contactEmail}`}
              className="text-white underline underline-offset-2 hover:text-gray-200"
            >
              {contactEmail}
            </a>
            .
          </p>
        </section>

        <p className="text-xs text-gray-600 mt-12 border-t border-gray-800 pt-6">
          © {new Date().getFullYear()} {appName}. All rights reserved.
        </p>
      </div>
    </main>
  );
}
