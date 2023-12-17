import * as fs from "fs";
import * as path from "path";

const environments = {
  dev: "dev",
  prod: "prod",
} as const;
export const ENVIRONMENTS = Object.values(environments);
export type Environment = keyof typeof environments;


export type SftpUser = {
  /**
   * The SFTP username
   */
  username: string;

  /**
   * The SFTP home directory the user will be confined to
   */
  homeDirectory: string;

  /**
   * The User's public key
   */
  publicKey: string;
}


export type Config = {
  /**
   * The environment name
   */
  env: Environment,
  /**  The AWS account and region */
  awsEnv: {
    account: string;
    region: string;
  },
  /**
   * Optional. The domain name and certificate to use for the SFTP server.
   * If specified, the full domain will be: `${subdomain}.${hostedZone.name}`
   * If not specified, the SFTP server will be created with the default AWS Server domain.
   */
  domain?: {
    subdomain: string;
    hostedZone: {
      name: string;
      id: string;
    }
    certificateArn: string;
  },
  /**
   * The test user that will be used to test the SFTP server in the Lambda Custom Resource.
   * It extends the normal user to also store the private key secret name.
   */
  testUser: SftpUser & {
    privateKeySecretName: string;
  },
  /**
   * The agency users that will be created on the SFTP server.
   */
  agencyUsers: SftpUser[],
  /**
   * The email address to send the alert to when an agency has not uploaded data for a day.
   * It will also receive infra notifications like Lambda Errors or DLQ messages visible.
   */
  alertMissingDataEmail: string,
  /**
   * Test options to use when testing locally. They should be assigned after the first deployment.
   */
  testOptions: {
    sftpHost?: string,
    bucketName?: string,
    snsAlertTopicArn?: string
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
      account: '192024214558',
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