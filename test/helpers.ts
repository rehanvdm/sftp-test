import {fromIni} from "@aws-sdk/credential-providers";
import {configs} from "../config";

export async function setAwsEnv() {
  const config = configs.dev;
  const credentialsProvider = fromIni({
    profile: "systanics-prod-exported",
  });

  const credentials = await credentialsProvider();
  process.env.AWS_ACCESS_KEY_ID = credentials.accessKeyId;
  process.env.AWS_SECRET_ACCESS_KEY = credentials.secretAccessKey;
  if (credentials.sessionToken) {
    process.env.AWS_SESSION_TOKEN = credentials.sessionToken;
  }
  process.env.AWS_REGION = config.awsEnv.region;
}