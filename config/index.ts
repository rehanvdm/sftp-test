import * as fs from "fs";
import * as path from "path";

const environments = {
  dev: "dev",
  prod: "prod",
} as const;
export const ENVIRONMENTS = Object.values(environments);
export type Environment = keyof typeof environments;

export type SftpUser = {
  username: string;
  homeDirectory: string;
  publicKey: string;
}

export type Config = {
  env: Environment,
  awsEnv: {
    account: string;
    region: string;
  },
  domain?: {
    subdomain: string;
    hostedZone: {
      name: string;
      id: string;
    }
    certificateArn: string;
  },
  testUser: SftpUser & {
    privateKeySecretName: string;
  },
  agencyUsers: SftpUser[],
  alertMissingDataEmail: string,
  testOptions: {
    sftpHost?: string, // Assign after first deployment to test locally
    bucketName?: string, // Assign after first deployment to test locally
    snsAlertTopicArn?: string // Assign after first deployment to test locally
  }
}

const getFile = (filename: string) => {
  return fs.readFileSync(path.resolve(__dirname,filename), {encoding: 'utf8'})
}
const testUserSecretName = (env: Environment, username: string) => {
    return `sftp-${env}/${username}`;
}

export const configs: Record<Environment, Config> = {
  dev: {
    env: "dev",
    awsEnv: {
      account: '134204159843', //Rehan's account
      region: 'eu-west-1',
    },
    domain: {
      subdomain: 'dev-sftp',
      hostedZone: {
        name: 'cloudglance.dev',
        id: 'Z00207693EFTEHNB4JIE7'
      },
      certificateArn: 'arn:aws:acm:eu-west-1:134204159843:certificate/b67ae536-3864-4aff-97e8-f7adf7aafbc1',
    },
    testUser: {
      username: 'test-automation',
      homeDirectory: 'test-automation',
      publicKey: getFile('./sftp-user-public-keys/test_automation.pub'),
      privateKeySecretName: testUserSecretName('dev', 'test-automation')
    },
    agencyUsers: [
      {
        username: 'agency-1',
        homeDirectory: 'agency-1',
        publicKey: getFile('./sftp-user-public-keys/agency_1.pub')
      }
    ],
    alertMissingDataEmail: 'rehan.vdm4@gmail.com',
    testOptions: {
      // sftpHost: "s-b8d6b48d84a74f8d8.server.transfer.eu-west-1.amazonaws.com",
      sftpHost: "dev-sftp.cloudglance.dev",
      bucketName: "sftp-tha-rehan-dev-sftp-storage",
      snsAlertTopicArn: "arn:aws:sns:eu-west-1:134204159843:sftp-tha-rehan-dev-sftptharehandevalarmtopic53408353-2saqJeK1vO9I"
    }
  },
  prod: {
    env: "prod",
    awsEnv: {
      account: '',
      region: 'eu-west-1',
    },
    testUser: {
      username: 'test-automation',
      homeDirectory: 'test-automation',
      publicKey: getFile('./sftp-user-public-keys/test_automation.pub'),
      privateKeySecretName: testUserSecretName('prod', 'test-automation')
    },
    agencyUsers: [
      {
        username: 'agency-1',
        homeDirectory: 'agency-1',
        publicKey: getFile('./sftp-user-public-keys/agency_1.pub')
      }
    ],
    alertMissingDataEmail: 'rehan.vdm4@gmail.com',
    testOptions: {
      sftpHost: "",
      bucketName: "",
      snsAlertTopicArn: ""
    }
  }
}