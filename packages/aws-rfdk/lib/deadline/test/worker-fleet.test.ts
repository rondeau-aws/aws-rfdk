/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {ABSENT, expect as expectCDK, haveResource, haveResourceLike} from '@aws-cdk/assert';
import {
  GenericLinuxImage,
  GenericWindowsImage,
  InstanceClass,
  InstanceSize,
  InstanceType,
  IVpc,
  SecurityGroup,
  SubnetType,
  Vpc,
} from '@aws-cdk/aws-ec2';
import {
  AssetImage,
  ContainerImage,
} from '@aws-cdk/aws-ecs';
import {ArtifactMetadataEntryType} from '@aws-cdk/cloud-assembly-schema';
import {App, CfnElement, Size, Stack} from '@aws-cdk/core';
import {
  IRenderQueue,
  RenderQueue,
  Repository,
  VersionQuery,
  WorkerFleet,
} from '../lib';
import {
  CONFIG_WORKER_ASSET_LINUX,
  CWA_ASSET_LINUX,
  RQ_CONNECTION_ASSET,
} from './asset-constants';

let app: App;
let stack: Stack;
let wfstack: Stack;
let vpc: IVpc;
let renderQueue: IRenderQueue;
let rcsImage: AssetImage;

beforeEach(() => {
  app = new App();
  stack = new Stack(app, 'infraStack', {
    env: {
      region: 'us-east-1',
    },
  });
  vpc = new Vpc(stack, 'VPC');
  rcsImage = ContainerImage.fromAsset(__dirname);
  const version = VersionQuery.exact(stack, 'Version', {
    majorVersion: 10,
    minorVersion: 0,
    releaseVersion: 0,
    patchVersion: 0,
  });
  renderQueue = new RenderQueue(stack, 'RQ', {
    version,
    vpc,
    images: { remoteConnectionServer: rcsImage },
    repository: new Repository(stack, 'Repository', {
      vpc,
      version,
    }),
  });
  wfstack = new Stack(app, 'workerFleetStack', {
    env: {
      region: 'us-east-1',
    },
  });
});

test('default worker fleet is created correctly', () => {
  // WHEN
  const fleet = new WorkerFleet(wfstack, 'workerFleet', {
    vpc,
    workerMachineImage: new GenericWindowsImage({
      'us-east-1': 'ami-any',
    }),
    renderQueue,
  });

  // THEN
  expectCDK(wfstack).to(haveResource('AWS::AutoScaling::AutoScalingGroup'));
  expectCDK(wfstack).to(haveResourceLike('AWS::AutoScaling::LaunchConfiguration', {
    InstanceType: 't2.large',
    spotPrice: ABSENT,
  }));
  expectCDK(wfstack).to(haveResourceLike('AWS::EC2::SecurityGroupIngress', {
    IpProtocol: 'tcp',
    ToPort: parseInt(renderQueue.endpoint.portAsString(), 10),
    SourceSecurityGroupId: {
      'Fn::GetAtt': [
        stack.getLogicalId(fleet.fleet.connections.securityGroups[0].node.defaultChild as CfnElement),
        'GroupId',
      ],
    },
    GroupId: {
      'Fn::ImportValue': 'infraStack:ExportsOutputFnGetAttRQAlbEc2ServicePatternLBSecurityGroupCA2B91D3GroupId1AAC6AC8',
    },
  }));
  expectCDK(wfstack).to(haveResource('Custom::LogRetention', {
    RetentionInDays: 3,
    LogGroupName: 'deadlineworkerFleet',
  }));
  expect(fleet.node.metadata[0].type).toMatch(ArtifactMetadataEntryType.WARN);
  expect(fleet.node.metadata[0].data).toContain('being created without a health monitor attached to it. This means that the fleet will not automatically scale-in to 0 if the workers are unhealthy');
});

test('security group is added to fleet after its creation', () => {
  // WHEN
  const fleet = new WorkerFleet(stack, 'workerFleet', {
    vpc,
    workerMachineImage: new GenericWindowsImage({
      'us-east-1': 'ami-any',
    }),
    renderQueue,
  });

  fleet.addSecurityGroup(SecurityGroup.fromSecurityGroupId(stack, 'SG', 'sg-123456789', {
    allowAllOutbound: false,
  }));

  // THEN
  expectCDK(stack).to(haveResourceLike('AWS::AutoScaling::LaunchConfiguration', {
    SecurityGroups: [
      {
        'Fn::GetAtt': [
          stack.getLogicalId(fleet.fleet.connections.securityGroups[0].node.defaultChild as CfnElement),
          'GroupId',
        ],
      },
      'sg-123456789',
    ],
  }));
});

test('default worker fleet is created correctly with linux image', () => {
  // WHEN
  new WorkerFleet(stack, 'workerFleet', {
    vpc,
    workerMachineImage: new GenericLinuxImage({
      'us-east-1': '123',
    }),
    renderQueue,
  });

  // THEN
  expectCDK(stack).to(haveResource('AWS::AutoScaling::AutoScalingGroup'));
  expectCDK(stack).to(haveResourceLike('AWS::AutoScaling::LaunchConfiguration'));
});

test('default worker fleet is created correctly with spot config', () => {
  // WHEN
  new WorkerFleet(wfstack, 'workerFleet', {
    vpc,
    workerMachineImage: new GenericLinuxImage({
      'us-east-1': '123',
    }),
    renderQueue,
    spotPrice: 2.5,
  });

  // THEN
  expectCDK(wfstack).to(haveResource('AWS::AutoScaling::AutoScalingGroup'));
  expectCDK(wfstack).to(haveResourceLike('AWS::AutoScaling::LaunchConfiguration', {
    SpotPrice: '2.5',
  }));
});

test('default worker fleet is not created with incorrect spot config', () => {
  // WHEN
  expect(() => {
    new WorkerFleet(wfstack, 'workerFleet', {
      vpc,
      workerMachineImage: new GenericLinuxImage({
        'us-east-1': '123',
      }),
      renderQueue,
      spotPrice: WorkerFleet.SPOT_PRICE_MAX_LIMIT + 1,
    });
  }).toThrowError(/Invalid value: 256 for property 'spotPrice'. Valid values can be any decimal between 0.001 and 255./);

  // WHEN
  expect(() => {
    new WorkerFleet(wfstack, 'workerFleet2', {
      vpc,
      workerMachineImage: new GenericLinuxImage({
        'us-east-1': '123',
      }),
      renderQueue,
      spotPrice: WorkerFleet.SPOT_PRICE_MIN_LIMIT / 2,
    });
  }).toThrowError(/Invalid value: 0.0005 for property 'spotPrice'. Valid values can be any decimal between 0.001 and 255./);
});

test('default worker fleet is created correctly custom Instance type', () => {
  // WHEN
  new WorkerFleet(stack, 'workerFleet', {
    vpc,
    workerMachineImage: new GenericLinuxImage({
      'us-east-1': '123',
    }),
    renderQueue,
    instanceType: InstanceType.of(InstanceClass.T2, InstanceSize.MEDIUM),
  });

  // THEN
  expectCDK(stack).to(haveResourceLike('AWS::AutoScaling::LaunchConfiguration', {
    InstanceType: 't2.medium',
  }));
});

test('default worker fleet is created correctly with custom LogGroup prefix', () => {
  // WHEN
  new WorkerFleet(stack, 'workerFleet', {
    vpc,
    workerMachineImage: new GenericLinuxImage({
      'us-east-1': '123',
    }),
    renderQueue,
    logGroupProps: {logGroupPrefix: 'test-prefix'},
  });

  expectCDK(stack).to(haveResource('Custom::LogRetention', {
    RetentionInDays: 3,
    LogGroupName: 'test-prefixworkerFleet',
  }));
});

test('default worker fleet is created correctly custom subnet values', () => {
  vpc = new Vpc(stack, 'VPC1Az', {
    maxAzs: 1,
  });

  // WHEN
  const workers = new WorkerFleet(stack, 'workerFleet', {
    vpc,
    workerMachineImage: new GenericLinuxImage({
      'us-east-1': '123',
    }),
    renderQueue,
    instanceType: InstanceType.of(InstanceClass.T2, InstanceSize.MEDIUM),
    vpcSubnets: {
      subnetType: SubnetType.PUBLIC,
    },
    healthCheckConfig: {
      port: 6161,
    },
  });

  // THEN
  expectCDK(stack).to(haveResourceLike('AWS::AutoScaling::AutoScalingGroup', {
    VPCZoneIdentifier: [{
      Ref: 'VPC1AzPublicSubnet1Subnet9649CC17',
    }],
  }));
  const userData = stack.resolve(workers.fleet.userData.render());
  expect(userData).toStrictEqual({
    'Fn::Join': [
      '',
      [
        '#!/bin/bash\nfunction exitTrap(){\nexitCode=$?\n/opt/aws/bin/cfn-signal --stack infraStack --resource workerFleetASG25520D69 --region us-east-1 -e $exitCode || echo \'Failed to send Cloudformation Signal\'\n}\ntrap exitTrap EXIT\nmkdir -p $(dirname \'/tmp/',
        {
          'Fn::Select': [
            0,
            {
              'Fn::Split': [
                '||',
                {Ref: CWA_ASSET_LINUX.Key},
              ],
            },
          ],
        },
        {
          'Fn::Select': [
            1,
            {
              'Fn::Split': [
                '||',
                {Ref: CWA_ASSET_LINUX.Key},
              ],
            },
          ],
        },
        '\')\naws s3 cp \'s3://',
        {Ref: CWA_ASSET_LINUX.Bucket},
        '/',
        {
          'Fn::Select': [
            0,
            {
              'Fn::Split': [
                '||',
                {Ref: CWA_ASSET_LINUX.Key},
              ],
            },
          ],
        },
        {
          'Fn::Select': [
            1,
            {
              'Fn::Split': [
                '||',
                {Ref: CWA_ASSET_LINUX.Key},
              ],
            },
          ],
        },
        '\' \'/tmp/',
        {
          'Fn::Select': [
            0,
            {
              'Fn::Split': [
                '||',
                {Ref: CWA_ASSET_LINUX.Key},
              ],
            },
          ],
        },
        {
          'Fn::Select': [
            1,
            {
              'Fn::Split': [
                '||',
                {Ref: CWA_ASSET_LINUX.Key},
              ],
            },
          ],
        },
        '\'\n' +
        'set -e\n' +
        'chmod +x \'/tmp/',
        {
          'Fn::Select': [
            0,
            {
              'Fn::Split': [
                '||',
                {
                  Ref: CWA_ASSET_LINUX.Key,
                },
              ],
            },
          ],
        },
        {
          'Fn::Select': [
            1,
            {
              'Fn::Split': [
                '||',
                {Ref: CWA_ASSET_LINUX.Key},
              ],
            },
          ],
        },
        '\'\n\'/tmp/',
        {
          'Fn::Select': [
            0,
            {
              'Fn::Split': [
                '||',
                {Ref: CWA_ASSET_LINUX.Key},
              ],
            },
          ],
        },
        {
          'Fn::Select': [
            1,
            {
              'Fn::Split': [
                '||',
                {Ref: CWA_ASSET_LINUX.Key},
              ],
            },
          ],
        },
        '\' ',
        {Ref: 'workerFleetStringParameterE88827AB'},
        '\nmkdir -p $(dirname \'/tmp/',
        {
          'Fn::Select': [
            0,
            {
              'Fn::Split': [
                '||',
                {Ref: RQ_CONNECTION_ASSET.Key},
              ],
            },
          ],
        },
        {
          'Fn::Select': [
            1,
            {
              'Fn::Split': [
                '||',
                {Ref: RQ_CONNECTION_ASSET.Key},
              ],
            },
          ],
        },
        '\')\naws s3 cp \'s3://',
        {Ref: RQ_CONNECTION_ASSET.Bucket},
        '/',
        {
          'Fn::Select': [
            0,
            {
              'Fn::Split': [
                '||',
                {Ref: RQ_CONNECTION_ASSET.Key},
              ],
            },
          ],
        },
        {
          'Fn::Select': [
            1,
            {
              'Fn::Split': [
                '||',
                {Ref: RQ_CONNECTION_ASSET.Key},
              ],
            },
          ],
        },
        "' '/tmp/",
        {
          'Fn::Select': [
            0,
            {
              'Fn::Split': [
                '||',
                {Ref: RQ_CONNECTION_ASSET.Key},
              ],
            },
          ],
        },
        {
          'Fn::Select': [
            1,
            {
              'Fn::Split': [
                '||',
                {Ref: RQ_CONNECTION_ASSET.Key},
              ],
            },
          ],
        },
        '\'\n' +
        'if [ -f \"/etc/profile.d/deadlineclient.sh\" ]; then\n' +
        '  source \"/etc/profile.d/deadlineclient.sh\"\n' +
        'fi\n' +
        '"${DEADLINE_PATH}/deadlinecommand" -executeScriptNoGui "/tmp/',
        {
          'Fn::Select': [
            0,
            {
              'Fn::Split': [
                '||',
                {Ref: RQ_CONNECTION_ASSET.Key},
              ],
            },
          ],
        },
        {
          'Fn::Select': [
            1,
            {
              'Fn::Split': [
                '||',
                {Ref: RQ_CONNECTION_ASSET.Key},
              ],
            },
          ],
        },
        '" --render-queue "http://',
        {
          'Fn::GetAtt': [
            'RQAlbEc2ServicePatternLB29395F99',
            'DNSName',
          ],
        },
        ':8080" \n' +
        'rm -f "/tmp/',
        {
          'Fn::Select': [
            0,
            {
              'Fn::Split': [
                '||',
                {Ref: RQ_CONNECTION_ASSET.Key},
              ],
            },
          ],
        },
        {
          'Fn::Select': [
            1,
            {
              'Fn::Split': [
                '||',
                {Ref: RQ_CONNECTION_ASSET.Key},
              ],
            },
          ],
        },
        '\"\n' +
        'if service --status-all | grep -q "Deadline 10 Launcher"; then\n' +
        '  service deadline10launcher restart\n' +
        'fi\n' +
        "mkdir -p $(dirname '/tmp/",
        {
          'Fn::Select': [
            0,
            {
              'Fn::Split': [
                '||',
                {Ref: CONFIG_WORKER_ASSET_LINUX.Key},
              ],
            },
          ],
        },
        {
          'Fn::Select': [
            1,
            {
              'Fn::Split': [
                '||',
                {Ref: CONFIG_WORKER_ASSET_LINUX.Key},
              ],
            },
          ],
        },
        "')\naws s3 cp 's3://",
        {Ref: CONFIG_WORKER_ASSET_LINUX.Bucket},
        '/',
        {
          'Fn::Select': [
            0,
            {
              'Fn::Split': [
                '||',
                {Ref: CONFIG_WORKER_ASSET_LINUX.Key},
              ],
            },
          ],
        },
        {
          'Fn::Select': [
            1,
            {
              'Fn::Split': [
                '||',
                {Ref: CONFIG_WORKER_ASSET_LINUX.Key},
              ],
            },
          ],
        },
        "' '/tmp/",
        {
          'Fn::Select': [
            0,
            {
              'Fn::Split': [
                '||',
                {Ref: CONFIG_WORKER_ASSET_LINUX.Key},
              ],
            },
          ],
        },
        {
          'Fn::Select': [
            1,
            {
              'Fn::Split': [
                '||',
                {Ref: CONFIG_WORKER_ASSET_LINUX.Key},
              ],
            },
          ],
        },
        "'\nset -e\nchmod +x '/tmp/",
        {
          'Fn::Select': [
            0,
            {
              'Fn::Split': [
                '||',
                {Ref: CONFIG_WORKER_ASSET_LINUX.Key},
              ],
            },
          ],
        },
        {
          'Fn::Select': [
            1,
            {
              'Fn::Split': [
                '||',
                {Ref: CONFIG_WORKER_ASSET_LINUX.Key},
              ],
            },
          ],
        },
        "'\n'/tmp/",
        {
          'Fn::Select': [
            0,
            {
              'Fn::Split': [
                '||',
                {Ref: CONFIG_WORKER_ASSET_LINUX.Key},
              ],
            },
          ],
        },
        {
          'Fn::Select': [
            1,
            {
              'Fn::Split': [
                '||',
                {Ref: CONFIG_WORKER_ASSET_LINUX.Key},
              ],
            },
          ],
        },
        "' '6161' '' '' ''",
      ],
    ],
  });
});

test('default worker fleet is created correctly with groups, pools and region', () => {
  vpc = new Vpc(stack, 'VPC1Az', {
    maxAzs: 1,
  });

  // WHEN
  const workers = new WorkerFleet(stack, 'workerFleet', {
    vpc,
    workerMachineImage: new GenericLinuxImage({
      'us-east-1': '123',
    }),
    renderQueue,
    instanceType: InstanceType.of(InstanceClass.T2, InstanceSize.MEDIUM),
    vpcSubnets: {
      subnetType: SubnetType.PUBLIC,
    },
    groups: ['A', 'B'],
    pools: ['C', 'D'],
    region: 'E',
  });

  // THEN
  const userData = stack.resolve(workers.fleet.userData.render());
  expect(userData).toStrictEqual({
    'Fn::Join': ['', [
      '#!/bin/bash\nfunction exitTrap(){\nexitCode=$?\n/opt/aws/bin/cfn-signal --stack infraStack --resource workerFleetASG25520D69 --region us-east-1 -e $exitCode || echo \'Failed to send Cloudformation Signal\'\n}\ntrap exitTrap EXIT\nmkdir -p $(dirname \'/tmp/',
      {
        'Fn::Select': [
          0,
          {
            'Fn::Split': [
              '||',
              {Ref: CWA_ASSET_LINUX.Key},
            ],
          },
        ],
      },
      {
        'Fn::Select': [
          1,
          {
            'Fn::Split': [
              '||',
              {Ref: CWA_ASSET_LINUX.Key},
            ],
          },
        ],
      },
      "')\naws s3 cp 's3://",
      {Ref: CWA_ASSET_LINUX.Bucket},
      '/',
      {
        'Fn::Select': [
          0,
          {
            'Fn::Split': [
              '||',
              {Ref: CWA_ASSET_LINUX.Key},
            ],
          },
        ],
      },
      {
        'Fn::Select': [
          1,
          {
            'Fn::Split': [
              '||',
              {Ref: CWA_ASSET_LINUX.Key},
            ],
          },
        ],
      },
      "' '/tmp/",
      {
        'Fn::Select': [
          0,
          {
            'Fn::Split': [
              '||',
              {Ref: CWA_ASSET_LINUX.Key},
            ],
          },
        ],
      },
      {
        'Fn::Select': [
          1,
          {
            'Fn::Split': [
              '||',
              {Ref: CWA_ASSET_LINUX.Key},
            ],
          },
        ],
      },
      "'\nset -e\nchmod +x '/tmp/",
      {
        'Fn::Select': [
          0,
          {
            'Fn::Split': [
              '||',
              {Ref: CWA_ASSET_LINUX.Key},
            ],
          },
        ],
      },
      {
        'Fn::Select': [
          1,
          {
            'Fn::Split': [
              '||',
              {Ref: CWA_ASSET_LINUX.Key},
            ],
          },
        ],
      },
      "'\n'/tmp/",
      {
        'Fn::Select': [
          0,
          {
            'Fn::Split': [
              '||',
              {Ref: CWA_ASSET_LINUX.Key},
            ],
          },
        ],
      },
      {
        'Fn::Select': [
          1,
          {
            'Fn::Split': [
              '||',
              {Ref: CWA_ASSET_LINUX.Key},
            ],
          },
        ],
      },
      "' ",
      {Ref: 'workerFleetStringParameterE88827AB'},
      '\nmkdir -p $(dirname \'/tmp/',
      {
        'Fn::Select': [
          0,
          {
            'Fn::Split': [
              '||',
              {Ref: RQ_CONNECTION_ASSET.Key},
            ],
          },
        ],
      },
      {
        'Fn::Select': [
          1,
          {
            'Fn::Split': [
              '||',
              {Ref: RQ_CONNECTION_ASSET.Key},
            ],
          },
        ],
      },
      '\')\naws s3 cp \'s3://',
      {Ref: RQ_CONNECTION_ASSET.Bucket},
      '/',
      {
        'Fn::Select': [
          0,
          {
            'Fn::Split': [
              '||',
              {Ref: RQ_CONNECTION_ASSET.Key},
            ],
          },
        ],
      },
      {
        'Fn::Select': [
          1,
          {
            'Fn::Split': [
              '||',
              {Ref: RQ_CONNECTION_ASSET.Key},
            ],
          },
        ],
      },
      "' '/tmp/",
      {
        'Fn::Select': [
          0,
          {
            'Fn::Split': [
              '||',
              {Ref: RQ_CONNECTION_ASSET.Key},
            ],
          },
        ],
      },
      {
        'Fn::Select': [
          1,
          {
            'Fn::Split': [
              '||',
              {Ref: RQ_CONNECTION_ASSET.Key},
            ],
          },
        ],
      },
      '\'\n' +
      'if [ -f \"/etc/profile.d/deadlineclient.sh\" ]; then\n' +
      '  source \"/etc/profile.d/deadlineclient.sh\"\n' +
      'fi\n' +
      '"${DEADLINE_PATH}/deadlinecommand" -executeScriptNoGui "/tmp/',
      {
        'Fn::Select': [
          0,
          {
            'Fn::Split': [
              '||',
              {Ref: RQ_CONNECTION_ASSET.Key},
            ],
          },
        ],
      },
      {
        'Fn::Select': [
          1,
          {
            'Fn::Split': [
              '||',
              {Ref: RQ_CONNECTION_ASSET.Key},
            ],
          },
        ],
      },
      '" --render-queue "http://',
      {
        'Fn::GetAtt': [
          'RQAlbEc2ServicePatternLB29395F99',
          'DNSName',
        ],
      },
      ':8080" \n' +
      'rm -f "/tmp/',
      {
        'Fn::Select': [
          0,
          {
            'Fn::Split': [
              '||',
              {Ref: RQ_CONNECTION_ASSET.Key},
            ],
          },
        ],
      },
      {
        'Fn::Select': [
          1,
          {
            'Fn::Split': [
              '||',
              {Ref: RQ_CONNECTION_ASSET.Key},
            ],
          },
        ],
      },
      '\"\n' +
      'if service --status-all | grep -q "Deadline 10 Launcher"; then\n' +
      '  service deadline10launcher restart\n' +
      'fi\n' +
      "mkdir -p $(dirname '/tmp/",
      {
        'Fn::Select': [
          0,
          {
            'Fn::Split': [
              '||',
              {Ref: CONFIG_WORKER_ASSET_LINUX.Key},
            ],
          },
        ],
      },
      {
        'Fn::Select': [
          1,
          {
            'Fn::Split': [
              '||',
              {Ref: CONFIG_WORKER_ASSET_LINUX.Key},
            ],
          },
        ],
      },
      "')\naws s3 cp 's3://",
      {Ref: CONFIG_WORKER_ASSET_LINUX.Bucket},
      '/',
      {
        'Fn::Select': [
          0,
          {
            'Fn::Split': [
              '||',
              {Ref: CONFIG_WORKER_ASSET_LINUX.Key},
            ],
          },
        ],
      },
      {
        'Fn::Select': [
          1,
          {
            'Fn::Split': [
              '||',
              {Ref: CONFIG_WORKER_ASSET_LINUX.Key},
            ],
          },
        ],
      },
      "' '/tmp/",
      {
        'Fn::Select': [
          0,
          {
            'Fn::Split': [
              '||',
              {Ref: CONFIG_WORKER_ASSET_LINUX.Key},
            ],
          },
        ],
      },
      {
        'Fn::Select': [
          1,
          {
            'Fn::Split': [
              '||',
              {Ref: CONFIG_WORKER_ASSET_LINUX.Key},
            ],
          },
        ],
      },
      "'\nset -e\nchmod +x '/tmp/",
      {
        'Fn::Select': [
          0,
          {
            'Fn::Split': [
              '||',
              {Ref: CONFIG_WORKER_ASSET_LINUX.Key},
            ],
          },
        ],
      },
      {
        'Fn::Select': [
          1,
          {
            'Fn::Split': [
              '||',
              {Ref: CONFIG_WORKER_ASSET_LINUX.Key},
            ],
          },
        ],
      },
      "'\n'/tmp/",
      {
        'Fn::Select': [
          0,
          {
            'Fn::Split': [
              '||',
              {Ref: CONFIG_WORKER_ASSET_LINUX.Key},
            ],
          },
        ],
      },
      {
        'Fn::Select': [
          1,
          {
            'Fn::Split': [
              '||',
              {Ref: CONFIG_WORKER_ASSET_LINUX.Key},
            ],
          },
        ],
      },
      "' '63415' 'a,b' 'c,d' 'E'",
    ]],
  });
});

test('worker fleet does validation correctly with groups, pools and region', () => {
  vpc = new Vpc(stack, 'VPC1Az', {
    maxAzs: 1,
  });

  // group name as 'none'
  expect(() => {
    new WorkerFleet(stack, 'workerFleet', {
      vpc,
      workerMachineImage: new GenericLinuxImage({
        'us-east-1': '123',
      }),
      renderQueue,
      groups: ['A', 'none'],
    });
  }).toThrowError();

  // group name with whitespace
  expect(() => {
    new WorkerFleet(stack, 'workerFleet1', {
      vpc,
      workerMachineImage: new GenericLinuxImage({
        'us-east-1': '123',
      }),
      renderQueue,
      groups: ['A', 'no ne'],
    });
  }).toThrowError(/Invalid value: no ne for property 'groups'/);

  // pool name with whitespace
  expect(() => {
    new WorkerFleet(stack, 'workerFleet2', {
      vpc,
      workerMachineImage: new GenericLinuxImage({
        'us-east-1': '123',
      }),
      renderQueue,
      pools: ['A', 'none'],
    });
  }).toThrowError(/Invalid value: none for property 'pools'/);

  // pool name as 'none'
  expect(() => {
    new WorkerFleet(stack, 'workerFleet3', {
      vpc,
      workerMachineImage: new GenericLinuxImage({
        'us-east-1': '123',
      }),
      renderQueue,
      pools: ['A', 'none'],
    });
  }).toThrowError(/Invalid value: none for property 'pools'/);

  // region as 'none'
  expect(() => {
    new WorkerFleet(stack, 'workerFleet4', {
      vpc,
      workerMachineImage: new GenericLinuxImage({
        'us-east-1': '123',
      }),
      renderQueue,
      region: 'none',
    });
  }).toThrowError(/Invalid value: none for property 'region'/);

  // region as 'all'
  expect(() => {
    new WorkerFleet(stack, 'workerFleet5', {
      vpc,
      workerMachineImage: new GenericLinuxImage({
        'us-east-1': '123',
      }),
      renderQueue,
      region: 'all',
    });
  }).toThrowError(/Invalid value: all for property 'region'/);

  // region as 'unrecognized'
  expect(() => {
    new WorkerFleet(stack, 'workerFleet6', {
      vpc,
      workerMachineImage: new GenericLinuxImage({
        'us-east-1': '123',
      }),
      renderQueue,
      region: 'unrecognized',
    });
  }).toThrowError(/Invalid value: unrecognized for property 'region'/);

  // region with invalid characters
  expect(() => {
    new WorkerFleet(stack, 'workerFleet7', {
      vpc,
      workerMachineImage: new GenericLinuxImage({
        'us-east-1': '123',
      }),
      renderQueue,
      region: 'none@123',
    });
  }).toThrowError(/Invalid value: none@123 for property 'region'/);

  // region with reserved name as substring
  expect(() => {
    new WorkerFleet(stack, 'workerFleet8', {
      vpc,
      workerMachineImage: new GenericLinuxImage({
        'us-east-1': '123',
      }),
      renderQueue,
      region: 'none123',
    });
  }).not.toThrowError();

  // region with case-insensitive name
  expect(() => {
    new WorkerFleet(stack, 'workerFleet9', {
      vpc,
      workerMachineImage: new GenericLinuxImage({
        'us-east-1': '123',
      }),
      renderQueue,
      region: 'None',
    });
  }).toThrowError(/Invalid value: None for property 'region'/);
});

test('worker fleet is created correctly with the specified encrypted EBS block device size', () => {
  vpc = new Vpc(stack, 'VPC1Az', {
    maxAzs: 1,
  });

  // WHEN
  const gibibytes = 123;
  new WorkerFleet(stack, 'workerFleet', {
    vpc,
    workerMachineImage: new GenericLinuxImage({
      'us-east-1': '123',
    }),
    renderQueue,
    blockDeviceVolumeSize: Size.gibibytes(gibibytes),
  });

  // THEN
  expectCDK(stack).to(haveResourceLike('AWS::AutoScaling::LaunchConfiguration', {
    BlockDeviceMappings: [
      {
        Ebs: {
          Encrypted: true,
          VolumeSize: gibibytes,
        },
      },
    ],
  }));
});

test('worker fleet creation fails when the specified EBS block device size must be rounded', () => {
  vpc = new Vpc(stack, 'VPC1Az', {
    maxAzs: 1,
  });

  expect(() => {
    new WorkerFleet(stack, 'workerFleet', {
      vpc,
      workerMachineImage: new GenericLinuxImage({
        'us-east-1': '123',
      }),
      renderQueue,
      blockDeviceVolumeSize: Size.kibibytes(1),
    });
  }).toThrowError(/'[0-9]+ .*bytes' cannot be converted into a whole number of gibibytes./);
});