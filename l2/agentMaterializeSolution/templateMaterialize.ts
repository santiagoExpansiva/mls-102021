/// <mls fileReference="_102021_/l2/agentMaterializeSolution/templateMaterialize.ts" enhancement="_blank"/>

export function buildModuleTs(project: number, moduleName: string): string {
    return `/// <mls fileReference="_${project}_/l2/${moduleName}/module.ts" enhancement="_blank" />
import type { AuraModuleFrontendDefinition, IPaths, ISkill, IGenomeConfig } from '/_102029_/l2/contracts/bootstrap.js';

export const moduleGenome: Record<string, IGenomeConfig> = {
  'web/desktop/page11': {
    designSystem: 'default',
    device: 'desktop',
    layout: 'standard',
  }
} as const;

export const shared: IPaths = {
  web: {
    sharedPath: '/_${project}_/l2/${moduleName}/web/shared',
    sharedSkill: '/_102020_/l2/agentMaterializeSolution/skills/genPageShared.ts'
  }
}

export const skills: ISkill = {
  definition:{
    skillPath:  ['_102034_.d.ts'],
  },
  architecture: {
    skillPath:  ['_102021_/l2/skills/architecture.md'],
  },
  layer1: {
    skillPath:  ['_102021_/l2/skills/layer_1.md'],
  },
  layer2: {
    skillPath:  ['_102021_/l2/skills/layer_2.md'],
  },
  layer3: {
    skillPath:  ['_102021_/l2/skills/layer_3.md'],
  },
  layer4: {
    skillPath:  ['_102021_/l2/skills/layer_4.md'],
  },
  contract: {
    skillPath: ["_102020_/l2/agentMaterializeSolution/skills/genContract.ts"],
  }
}

export const moduleStates = {} as const;

export const moduleShellPreferences = {
  layout: {
    asideMode: { desktop: 'inline', mobile: 'fullscreen' },
  },
} as const;

export const moduleFrontendDefinition: AuraModuleFrontendDefinition = {
  pageTitle: '${moduleName}',
  device: 'desktop',
  navigation: [],
  routes: [],
};
`;
}

export function buildIndexTs(project: number, moduleName: string): string {
    return `/// <mls fileReference="_${project}_/l2/${moduleName}/index.ts" enhancement="_blank" />
import { bootstrapCollabApp } from '/_102033_/l2/core/bootstrap.js';

void bootstrapCollabApp({
  projectId: '${project}',
  appId: '${moduleName}',
  title: 'Collab Test · ${moduleName}',
  shellMode: 'spa',
  navigation: [
    { label: 'Monitor', href: '/monitor' },
  ],
  pages: [],
});
`;
}

export function buildRouterTs(project: number, moduleName: string): string {
    const fnName = `create${moduleName.charAt(0).toUpperCase()}${moduleName.slice(1)}Router`;
    return `/// <mls fileReference="_${project}_/l1/${moduleName}/layer_2_controllers/router.ts" enhancement="_blank" />
import type { BffHandler } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

export function ${fnName}(): Map<string, BffHandler> {
  return new Map<string, BffHandler>([
  ]);
}
`;
}

export function buildPersistenceTs(project: number, moduleName: string): string {
    return `/// <mls fileReference="_${project}_/l1/${moduleName}/layer_1_external/persistence.ts" enhancement="_blank" />
import type { TableDefinition } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';

export const tableDefinitions: TableDefinition[] = [
];
`;
}

export function buildConfig(project: number, moduleName: string): string {
    return `{
  "defaultProjectId": "${project}",
  "shellTemplates": {
    "spa": "./_102033_/l2/shared/spa/index.html",
    "pwa": "./_102033_/l2/shared/pwa/index.html"
  },
  "publication": {
    "defaultTarget": "web",
    "targets": {
      "web": {
        "assetBaseUrl": "",
        "serveStaticFromServer": true,
        "minify": false,
        "sourcemap": true
      },
      "cdncloudflare": {
        "assetBaseUrl": "https://cdn.example.com",
        "serveStaticFromServer": false,
        "minify": true,
        "sourcemap": false
      }
    }
  },
  "clientShell": {
    "mode": "spa",
    "activeProfile": "production",
    "runtimeControls": {
      "setHeaderFunction": "window.collabAuraShellControls.setHeaderRenderer",
      "setAsideFunction": "window.collabAuraShellControls.setAsideRenderer",
      "setProfileFunction": "window.collabAuraShellControls.setShellProfile"
    },
    "regions": {
      "header": {
        "activeProfile": "production",
        "switchWithoutRouteReload": true,
        "profiles": {
          "production": {
            "renderer": {
              "entrypoint": "/_102033_/l2/shared/layout/aura-header.js",
              "source": "../mls-102033/l2/shared/layout/aura-header.ts",
              "tag": "collab-aura-header"
            },
            "brand": {
              "name": "${moduleName}",
              "logoText": "${moduleName.substring(0, 2).toUpperCase()}",
              "environmentLabel": "Producao"
            }
          },
          "studio": {
            "renderer": {
              "entrypoint": "/_102033_/l2/shared/layout/aura-header.js",
              "source": "../mls-102033/l2/shared/layout/aura-header.ts",
              "tag": "collab-aura-header"
            },
            "brand": {
              "name": "Collab Studio",
              "logoText": "CS",
              "environmentLabel": "Studio"
            }
          }
        }
      },
      "aside": {
        "activeProfile": "collabMessages",
        "switchWithoutRouteReload": true,
        "profiles": {
          "collabMessages": {
            "renderer": {
              "entrypoint": "/_102033_/l2/shared/layout/aura-aside.js",
              "source": "../mls-102033/l2/shared/layout/aura-aside.ts",
              "tag": "collab-aura-aside"
            },
            "widthPx": 375,
            "component": "collab-messages-102025",
            "appsMenuSource": "projects.${project}.modules[moduleId=${moduleName}].navigation"
          },
          "defaultAura": {
            "renderer": {
              "entrypoint": "/_102033_/l2/shared/layout/aura-aside.js",
              "source": "../mls-102033/l2/shared/layout/aura-aside.ts",
              "tag": "collab-aura-aside"
            },
            "widthPx": 280,
            "appsMenuSource": "projects.${project}.modules[moduleId=${moduleName}].navigation"
          }
        }
      }
    }
  },
  "projects": {
    "${project}": {
      "root": ".",
      "type": "client",
      "modules": [
        {
          "moduleId": "${moduleName}",
          "basePath": "/${moduleName}",
          "shellMode": "spa",
          "backendRouter": "./_${project}_/l1/${moduleName}/layer_2_controllers/router.js",
          "navigation": [],
          "frontend": {
            "layer": "l2",
            "moduleEntrypoint": "./_${project}_/l2/${moduleName}/module.js",
            "moduleSource": "l2/${moduleName}/module.ts",
            "pages": [
            ]
          },
          "backend": {
            "layer": "l1",
            "router": "./_${project}_/l1/${moduleName}/layer_2_controllers/router.js",
            "routerSource": "l1/${moduleName}/layer_2_controllers/router.ts",
            "usecasesPath": "l1/${moduleName}/layer_3_usecases",
            "entitiesPath": "l1/${moduleName}/layer_4_entities",
            "externalPath": "l1/${moduleName}/layer_1_external"
          }
        }
      ],
      "persistenceModules": [
        {
          "moduleId": "${moduleName}",
          "persistenceEntrypoint": "./_${project}_/l1/${moduleName}/persistence.js"
        }
      ]
    },
    "102033": {
      "root": "../mls-102033",
      "type": "master frontend"
    },
    "102034": {
      "root": "../mls-102034",
      "type": "master backend",
      "modules": [
        {
          "moduleId": "mdm",
          "basePath": "/mdm",
          "shellMode": "spa",
          "backendRouter": "./_102034_/l1/mdm/layer_2_controllers/router.js"
        },
        {
          "moduleId": "monitor",
          "basePath": "/monitor",
          "shellMode": "spa",
          "backendRouter": "./_102034_/l1/monitor/layer_2_controllers/router.js"
        },
        {
          "moduleId": "audit",
          "basePath": "/audit",
          "shellMode": "spa",
          "backendRouter": "./_102034_/l1/audit/layer_2_controllers/router.js"
        }
      ],
      "persistenceModules": [
        {
          "moduleId": "platform",
          "persistenceEntrypoint": "./_102034_/l1/server/persistence.js"
        },
        {
          "moduleId": "mdm",
          "persistenceEntrypoint": "./_102034_/l1/mdm/persistence.js"
        },
        {
          "moduleId": "monitor",
          "persistenceEntrypoint": "./_102034_/l1/monitor/persistence.js"
        }
      ]
    },
    "102027": {
      "root": "../mls-102027",
      "type": "lib"
    },
    "102029": {
      "root": "../mls-102029",
      "type": "lib"
    },
    "102036": {
      "root": "../mls-102036",
      "type": "lib"
    }
  }
}`;
}
