export function sanitizedEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const blocked = /^(AWS_|AZURE_|GCP_|GOOGLE_|GITHUB_TOKEN$|GH_TOKEN$|NPM_TOKEN$|DATABASE_URL$|MONGODB_URI$|.*_PASSWORD$|.*_SECRET$)$/i;
  for (const key of Object.keys(env)) if (blocked.test(key)) delete env[key];
  return env;
}
