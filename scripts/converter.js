// converter.js (with Prettier for Auto-formatting)
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import prettier from 'prettier';
import { render } from 'dom-serializer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- MODIFIED: Configuration Loading ---
// All configuration is now loaded from an external JSON file.
const config = fs.readJsonSync(path.join(__dirname, '../config.json'));
const { paths: pathConfig, componentization, formatting } = config;

// --- REPLACED: Constants are now derived from the config file ---
const SELF_CLOSING_TAGS = new Set(componentization.selfClosingTags);
const LAYOUT_CLASSES_OR_IDS = componentization.layoutIdentifiers;
const MIN_CHILDREN_FOR_REUSABLE_BY_REPETITION = componentization.minChildrenForRepetition;
const MIN_REPETITIONS_FOR_COMPONENT = componentization.minRepetitionsForComponent;

// --- NEW: Centralized Path Management ---
// All input and output paths are constructed here based on the config.
const REACT_OUTPUT_DIR = path.join(__dirname, pathConfig.reactOutput);
const SVGS_OUTPUT_DIR = path.join(REACT_OUTPUT_DIR, pathConfig.public, pathConfig.svgs);
const COMPONENTS_OUTPUT_DIR = path.join(REACT_OUTPUT_DIR, pathConfig.components);
const PAGES_OUTPUT_DIR = path.join(REACT_OUTPUT_DIR, pathConfig.pages);
const INPUT_ASTS_DIR = path.join(__dirname, pathConfig.asts);

// --- Global State (Modified) ---
// --- REMOVED: This global counter is the source of instability. ---
// let globalComponentCounter = 0;
const globalGeneratedComponentSignatures = new Map();
const globalGeneratedComponentJSXStrings = new Map();
// --- NEW: This map tracks which name is used by which fingerprint to detect collisions. ---
const globalNameUsage = new Map();


// =================================================================
// === UTILITY AND HELPER FUNCTIONS (SORTED FOR CORRECT ORDER)   ===
// =================================================================

// --- MODIFIED: Uses Prettier config from config.json ---
async function formatAndWriteFile(filePath, rawContent) {
  try {
    // The second argument now passes the formatting options from config.json
    const formattedContent = await prettier.format(rawContent, formatting.prettier);
    await fs.writeFile(filePath, formattedContent);
  } catch (error) {
    console.warn(
      `Could not format ${path.basename(
        filePath
      )} with Prettier. Writing raw content. Error: ${error.message}`
    );
    await fs.writeFile(filePath, rawContent);
  }
}

// --- UNCHANGED: The following helper functions require no changes ---
function toCamelCase(str) {
  return str
    .replace(/[-_ ]+([a-zA-Z0-9])/g, (_, char) => char.toUpperCase())
    .replace(/^[A-Z]/, (m) => m.toLowerCase());
}

function toPascalCase(str) {
  if (str === null || str === undefined) return 'Unnamed';
  const s = String(str);
  if (s.trim() === '') return 'Unnamed';
  const cleaned = s.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (cleaned) {
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  const fallbackWords = s
    .replace(/[^a-zA-Z0-9_-\s]/g, '')
    .split(/[\s_-]+/)
    .filter(Boolean);
  if (fallbackWords.length > 0) {
    return fallbackWords
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  }
  return 'UnnamedComponent';
}

function kebabToCamelCase(str) {
  return str.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
}

function styleStringToObject(styleString) {
  if (!styleString) return {};
  const style = {};
  styleString.split(';').forEach((declaration) => {
    const [property, value] = declaration.split(':');
    if (property && value) {
      style[kebabToCamelCase(property.trim())] = value.trim();
    }
  });
  return style;
}

function getStructuralSignature(node) {
  if (
    node.type === 'text' ||
    node.type === 'comment' ||
    node.type === 'directive'
  ) {
    return node.type;
  }
  if (node.type === 'tag' || node.type === 'script' || node.type === 'style') {
    const attrs = Object.keys(node.attribs || {})
      .sort()
      .join(',');
    const classAttr = node.attribs?.class
      ? `_CLASS_${node.attribs.class.split(/\s+/).sort().join('_')}`
      : '';
    const childrenSignatures = (node.children || [])
      .map(getStructuralSignature)
      .join('|');
    return `${node.name}[${attrs}${classAttr}](${childrenSignatures})`;
  }
  return `UNKNOWN_TYPE_${node.type}`;
}

function generatePropName(base, existingProps) {
  let count = 1;
  let propName = base;
  while (existingProps.has(propName)) {
    propName = `${base}${count++}`;
  }
  return propName;
}

function generateComponentFingerprint(jsxBody, propsSpec) {
  const propsSpecString = JSON.stringify(Object.keys(propsSpec || {}).sort());
  const contentToHash = `${jsxBody}::PROPS::${propsSpecString}`;
  return crypto.createHash('md5').update(contentToHash).digest('hex');
}

function guessTextRoleFromClassOrId(node) {
  const candidates = [
    node.attribs?.id,
    ...(node.attribs?.class?.split(/\s+/) || []),
  ];
  for (const str of candidates) {
    if (!str) continue;
    const lowered = str.toLowerCase();
    if (lowered.includes('title')) return 'title';
    if (lowered.includes('label')) return 'label';
    if (lowered.includes('desc')) return 'description';
    if (lowered.includes('header')) return 'header';
    if (lowered.includes('footer')) return 'footer';
    if (lowered.includes('button')) return 'buttonText';
    if (lowered.includes('caption')) return 'caption';
    if (lowered.includes('subtitle')) return 'subtitle';
    if (lowered.includes('item')) return 'itemText';
  }
  return null;
}

function findNodes(ast, criteriaFn) {
  const foundNodes = [];
  const traverse = (node) => {
    if (node && criteriaFn(node)) foundNodes.push(node);
    if (node?.children) node.children.forEach(traverse);
  };
  if (ast) traverse(ast);
  return foundNodes;
}

function isNodeAlreadyComponentPart(node, localComponentRegistry) {
  return localComponentRegistry.has(node);
}

function isNodeEligibleForComponentization(node, localComponentRegistry) {
  if (!node || node.type !== 'tag') return false;
  if (isNodeAlreadyComponentPart(node, localComponentRegistry)) return false;
  if (node.name === 'svg') return false;
  return true;
}


// =================================================================
// === CORE LOGIC FUNCTIONS (Largely unchanged, they use the constants defined above) ===
// =================================================================

function analyzeInstancesForProps(templateNode, instances) {
  // This function's logic is self-contained and requires no changes.
  const propsSpec = {};
  const collectPaths = (node, currentPath, callback) => {
    if (node.type === 'tag' && node.name === 'svg') {
      const svgStringValue = render(node, { xmlMode: true });
      callback(currentPath, svgStringValue, 'svg');
      return;
    }
    if (node.attribs)
      Object.keys(node.attribs).forEach((attrKey) =>
        callback(
          [...currentPath, 'attribs', attrKey],
          node.attribs[attrKey],
          'attribute'
        )
      );
    if (node.children)
      node.children.forEach((child, i) => {
        const childPath = [...currentPath, 'children', i];
        if (child.type === 'text' && child.data.trim())
          callback(childPath, child.data.trim(), 'textChild');
        else if (child.type === 'tag') collectPaths(child, childPath, callback);
      });
  };
  const templateValuesByPath = new Map();
  collectPaths(templateNode, [], (path, value, type) =>
    templateValuesByPath.set(path.join('.'), { value, type })
  );
  const differingPaths = new Map();
  instances.forEach((instance) => {
    if (instance === templateNode) return;
    collectPaths(instance, [], (path, value, type) => {
      const pathStr = path.join('.');
      const templateInfo = templateValuesByPath.get(pathStr);
      if (!templateInfo || String(value) !== String(templateInfo.value)) {
        if (!differingPaths.has(pathStr))
          differingPaths.set(pathStr, {
            type,
            values: new Set(),
            pathArray: path,
          });
        differingPaths.get(pathStr).values.add(value);
        if (templateInfo)
          differingPaths.get(pathStr).values.add(templateInfo.value);
      }
    });
  });
  let propCounter = 0;
  const existingPropNames = new Set();
  differingPaths.forEach(({ type, values, pathArray }) => {
    let basePropName;
    if (type === 'svg') {
      basePropName = 'iconSrc';
    } else if (type === 'attribute') {
      const attrKey = pathArray[pathArray.length - 1];
      let jsxCompliantAttrKey =
        attrKey === 'class'
          ? 'className'
          : attrKey === 'for'
            ? 'htmlFor'
            : attrKey;
      basePropName = kebabToCamelCase(jsxCompliantAttrKey);
    } else if (type === 'textChild') {
      const parentTagPath = pathArray.slice(0, -2);
      let parentNode = templateNode;
      parentTagPath.forEach((p) => (parentNode = parentNode?.[p]));
      basePropName =
        guessTextRoleFromClassOrId(parentNode) ||
        (parentNode?.name ? toCamelCase(parentNode.name + 'Text') : null) ||
        `text${propCounter++}`;
    } else basePropName = `prop${propCounter++}`;
    const finalPropName = generatePropName(basePropName, existingPropNames);
    existingPropNames.add(finalPropName);
    propsSpec[finalPropName] = {
      type,
      path: pathArray,
      values: Array.from(values),
    };
  });
  const templateChildrenSignature = (templateNode.children || [])
    .map(getStructuralSignature)
    .join('|');
  const instancesHaveDifferentChildStructure = instances.some(
    (inst) =>
      (inst.children || []).map(getStructuralSignature).join('|') !==
      templateChildrenSignature
  );
  if (
    instancesHaveDifferentChildStructure &&
    !Object.values(propsSpec).some((p) => p.type === 'children')
  ) {
    propsSpec[generatePropName('children', existingPropNames)] = {
      type: 'children',
      path: ['children'],
    };
  }
  return propsSpec;
}

function identifyComponents(bodyNode, localComponentRegistry) {
  // This function uses the constants defined from config, so no internal changes are needed.
  const signatures = new Map();
  const componentCandidates = [];
  LAYOUT_CLASSES_OR_IDS.forEach((identifier) => {
    findNodes(
      bodyNode,
      (node) =>
        node.type === 'tag' &&
        (node.attribs?.class?.split(' ').includes(identifier) ||
          node.attribs?.id === identifier)
    ).forEach((node) => {
      if (!isNodeAlreadyComponentPart(node, localComponentRegistry)) {
        const baseName = toPascalCase(identifier);
        const layoutPropsSpec = {};
        const tentativeName = `${baseName}Layout`;
        componentCandidates.push({
          nameAttempt: tentativeName,
          astNode: node,
          type: 'layout',
          propsSpec: layoutPropsSpec,
          instances: [node],
        });
      }
    });
  });
  const processedForRepetition = new Set();
  function findRepetitive(node, currentPath = []) {
    if (processedForRepetition.has(node)) return;
    if (
      isNodeEligibleForComponentization(node, localComponentRegistry) &&
      node.children &&
      node.children.length >= MIN_CHILDREN_FOR_REUSABLE_BY_REPETITION
    ) {
      const sig = getStructuralSignature(node);
      if (signatures.has(sig))
        signatures.get(sig).push({ node, path: currentPath });
      else signatures.set(sig, [{ node, path: currentPath }]);
    }
    (node.children || []).forEach((child, i) => {
      if (child.type === 'tag' && child.name === 'svg') {
        processedForRepetition.add(child);
        return;
      }
      findRepetitive(child, [...currentPath, 'children', i]);
    });
    processedForRepetition.add(node);
  }
  findRepetitive(bodyNode);
  signatures.forEach((nodesWithPaths) => {
    if (nodesWithPaths.length >= MIN_REPETITIONS_FOR_COMPONENT) {
      const firstNodeInstance = nodesWithPaths[0].node;
      if (isNodeAlreadyComponentPart(firstNodeInstance, localComponentRegistry))
        return;
      let baseName = 'Reusable';
      const classes = firstNodeInstance.attribs?.class
        ?.trim()
        .split(/\s+/)
        .filter(Boolean);
      if (classes && classes.length > 0) baseName = toPascalCase(classes[0]);
      else if (firstNodeInstance.attribs?.id)
        baseName = toPascalCase(firstNodeInstance.attribs.id);
      if (!baseName || baseName.length <= 1 || baseName === 'W')
        baseName = `${toPascalCase(firstNodeInstance.name)}Element`;
      const tentativeName = `${baseName}Item`;
      const propsSpec = analyzeInstancesForProps(
        firstNodeInstance,
        nodesWithPaths.map((nwp) => nwp.node)
      );
      componentCandidates.push({
        nameAttempt: tentativeName,
        astNode: firstNodeInstance,
        type: 'repetition',
        propsSpec,
        instances: nodesWithPaths.map((nwp) => nwp.node),
      });
    }
  });
  const countNodes = (n) =>
    1 + (n.children || []).reduce((sum, child) => sum + countNodes(child), 0);
  componentCandidates.sort(
    (a, b) => countNodes(a.astNode) - countNodes(b.astNode)
  );
  const finalComponentDefsForThisPage = [];
  for (const candidate of componentCandidates) {
    const componentBodyJsx = astNodeToJsx(
      candidate.astNode,
      0,
      true,
      candidate.propsSpec,
      [],
      localComponentRegistry,
      candidate.astNode
    );
    const fingerprint = generateComponentFingerprint(
      componentBodyJsx,
      candidate.propsSpec
    );
    let finalName,
      componentFilePath,
      isNewGlobalComponent = false;

    if (globalGeneratedComponentSignatures.has(fingerprint)) {
      const existingGlobalInfo =
        globalGeneratedComponentSignatures.get(fingerprint);
      finalName = existingGlobalInfo.name;
      componentFilePath = existingGlobalInfo.filePath;
      console.log(
        `Reusing component: ${finalName} (originally from ${candidate.nameAttempt})`
      );
    } else {
      // --- MODIFIED: Component Naming Logic for Stability ---
      // This new logic uses the fingerprint to create a stable name, avoiding the unstable counter.
      const baseName = candidate.nameAttempt;
      const existingFingerprintForName = globalNameUsage.get(baseName);

      if (!existingFingerprintForName) {
        // This name is not used yet, we can claim it.
        finalName = baseName;
        globalNameUsage.set(baseName, fingerprint);
      } else {
        // This name is already used by a different component. Create a unique, deterministic name.
        const shortHash = fingerprint.substring(0, 8);
        finalName = `${baseName}_${shortHash}`;
      }

      // The pathConfig constant from the config is used here.
      componentFilePath = path.join(pathConfig.components, `${finalName}.jsx`);
      isNewGlobalComponent = true;
    }
    candidate.instances.forEach((instanceNode) => {
      localComponentRegistry.set(instanceNode, {
        name: finalName,
        astNode: candidate.astNode,
        propsSpec: candidate.propsSpec,
      });
    });
    if (isNewGlobalComponent) {
      globalGeneratedComponentSignatures.set(fingerprint, {
        name: finalName,
        filePath: componentFilePath,
      });
      finalComponentDefsForThisPage.push({
        ...candidate,
        name: finalName,
        jsxBody: componentBodyJsx,
        filePath: componentFilePath,
      });
    }
  }
  return finalComponentDefsForThisPage;
}

function astNodeToJsx(
  node,
  depth = 0,
  isComponentDefinitionBody = false,
  componentPropsSpec = {},
  nodePath = [],
  localComponentRegistry,
  templateNodeForCurrentDefinition = null
) {
  // This function's logic is self-contained and requires no changes.
  if (!node) return '';

  if (
    localComponentRegistry &&
    localComponentRegistry.has(node) &&
    node !== templateNodeForCurrentDefinition
  ) {
    const compInfo = localComponentRegistry.get(node);
    const instanceProps = {};
    if (compInfo.propsSpec) {
      for (const propName in compInfo.propsSpec) {
        const spec = compInfo.propsSpec[propName];
        let valueToPass;
        if (spec.type === 'svg') {
          let svgNode = node;
          spec.path.forEach((p) => {
            if (svgNode) svgNode = svgNode[p];
          });
          if (svgNode) {
            if (svgNode.attribs && svgNode.attribs.viewbox) {
              svgNode.attribs.viewBox = svgNode.attribs.viewbox;
              delete svgNode.attribs.viewbox;
            }
            const svgString = render(svgNode, { xmlMode: true });
            const hash = crypto
              .createHash('md5')
              .update(svgString)
              .digest('hex');
            const svgFilename = `icon-${hash}.svg`;
            const svgDiskPath = path.join(SVGS_OUTPUT_DIR, svgFilename);
            fs.writeFile(svgDiskPath, svgString).catch((err) => {
              console.error(
                `Error sa pagsulat ng SVG file: ${svgDiskPath}`,
                err
              );
            });
            valueToPass = `/${pathConfig.svgs}/${svgFilename}`;
          } else {
            valueToPass = '';
          }
        } else if (spec.type === 'attribute') {
          let currentInstanceValNode = node;
          spec.path.forEach((p) => {
            if (currentInstanceValNode)
              currentInstanceValNode = currentInstanceValNode[p];
          });
          valueToPass = currentInstanceValNode;
        } else if (spec.type === 'textChild') {
          let currentInstanceTextNode = node;
          spec.path.forEach((p) => {
            if (currentInstanceTextNode)
              currentInstanceTextNode = currentInstanceTextNode[p];
          });
          valueToPass = currentInstanceTextNode?.data?.trim() || '';
        } else if (spec.type === 'children') {
          continue;
        }
        instanceProps[propName] = valueToPass;
      }
    }
    let childrenJsx = '';
    if (compInfo.propsSpec?.children) {
      childrenJsx = (node.children || [])
        .map((child) =>
          astNodeToJsx(
            child,
            depth + 1,
            false,
            {},
            [],
            localComponentRegistry,
            templateNodeForCurrentDefinition
          )
        )
        .join('');
    }

    let propsString = Object.entries(instanceProps)
      .map(([key, value]) => {
        if (value === undefined || value === null) return '';
        const jsxPropName = kebabToCamelCase(key);
        if (typeof value === 'boolean') {
          return value ? ` ${jsxPropName}` : ` ${jsxPropName}={false}`;
        }
        if (typeof value === 'number') {
          return ` ${jsxPropName}={${value}}`;
        }
        if (jsxPropName === 'style' && typeof value === 'string') {
          return ` ${jsxPropName}={${JSON.stringify(
            styleStringToObject(value)
          )}}`;
        }
        return ` ${jsxPropName}={${JSON.stringify(String(value))}}`;
      })
      .join('');

    if (childrenJsx.trim()) {
      return `<${compInfo.name}${propsString}>${childrenJsx}</${compInfo.name}>`;
    } else {
      return `<${compInfo.name}${propsString} />`;
    }
  }

  switch (node.type) {
    case 'text':
      if (isComponentDefinitionBody) {
        for (const propName in componentPropsSpec) {
          const spec = componentPropsSpec[propName];
          const currentPathStr = nodePath.join('.');
          const specPathStr = spec.path.join('.');
          if (spec.type === 'textChild' && specPathStr === currentPathStr) {
            return `{${propName} || '${node.data
              .trim()
              .replace(/'/g, "\\'")}'}`;
          }
        }
      }
      if (node.data.trim() === '')
        return node.data.length > 0 && !isComponentDefinitionBody
          ? node.data
          : '';
      return node.data.replace(/\{/g, '{"{"}').replace(/\}/g, '{"}"}');
    case 'comment':
      return `{/*${node.data.replace(/\*\//g, '*\\/')}*/}`;
    case 'directive':
      return '';
    case 'script':
      return '';
    case 'style':
      return '';
    case 'tag':
      if (node.name === 'svg' && node.attribs && node.attribs.viewbox) {
        node.attribs.viewBox = node.attribs.viewbox;
        delete node.attribs.viewbox;
      }

      if (isComponentDefinitionBody) {
        for (const propName in componentPropsSpec) {
          const spec = componentPropsSpec[propName];
          const currentPathStr = nodePath.join('.');
          const specPathStr = spec.path.join('.');
          if (spec.type === 'svg' && specPathStr === currentPathStr) {
            let altText = 'icon';
            const titleNode = (node.children || []).find(
              (child) => child.type === 'tag' && child.name === 'title'
            );
            if (titleNode && titleNode.children?.[0]?.type === 'text') {
              altText = titleNode.children[0].data.trim();
            }
            return `<img src={${propName}} alt="${altText.replace(
              /"/g,
              '\\"'
            )}" />`;
          }
        }
      }
      const tagName = node.name.toLowerCase();
      if (tagName === 'svg') {
        try {
          const svgString = render(node, { xmlMode: true });
          const hash = crypto
            .createHash('md5')
            .update(svgString)
            .digest('hex');
          const svgFilename = `icon-${hash}.svg`;
          const svgDiskPath = path.join(SVGS_OUTPUT_DIR, svgFilename);
          const publicSrcPath = `/${path.join(pathConfig.svgs, svgFilename).replace(/\\/g, '/')}`;
          fs.writeFile(svgDiskPath, svgString).catch((err) => {
            console.error(
              `Error writing SVG file: ${svgDiskPath}`,
              err
            );
          });
          let altText = 'icon';
          const titleNode = (node.children || []).find(
            (child) => child.type === 'tag' && child.name === 'title'
          );
          if (titleNode && titleNode.children?.[0]?.type === 'text') {
            altText = titleNode.children[0].data.trim();
          }
          return `<img src="${publicSrcPath}" alt="${altText.replace(
            /"/g,
            '\\"'
          )}" />`;
        } catch (e) {
          console.warn(
            'Nabigo sa pag-proseso ng static SVG. Ibabalik sa inline rendering.',
            e
          );
        }
      }
      let attribsString = '';
      if (node.attribs) {
        for (const originalHtmlAttrKey in node.attribs) {
          let originalHtmlAttrValue = node.attribs[originalHtmlAttrKey];
          let jsxPropNameForKey = kebabToCamelCase(originalHtmlAttrKey);
          if (jsxPropNameForKey === 'class') jsxPropNameForKey = 'className';
          else if (jsxPropNameForKey === 'for') jsxPropNameForKey = 'htmlFor';
          let attributeNameToRenderInJsx =
            originalHtmlAttrKey.startsWith('data-') ||
              originalHtmlAttrKey.startsWith('aria-')
              ? originalHtmlAttrKey
              : jsxPropNameForKey;
          if (isComponentDefinitionBody) {
            let isHandledAsProp = false;
            for (const componentPropName in componentPropsSpec) {
              const spec = componentPropsSpec[componentPropName];
              const pathInSpecToOriginalAttr = [
                ...nodePath,
                'attribs',
                originalHtmlAttrKey,
              ];
              if (
                spec.type === 'attribute' &&
                spec.path.every((p, i) => p === pathInSpecToOriginalAttr[i])
              ) {
                const propAccess = `${componentPropName}`;
                if (jsxPropNameForKey === 'style')
                  attribsString += ` style={${propAccess} || ${JSON.stringify(
                    styleStringToObject(originalHtmlAttrValue)
                  )}}`;
                else
                  attribsString += ` ${attributeNameToRenderInJsx}={${propAccess} || ${JSON.stringify(String(originalHtmlAttrValue))}}`;
                isHandledAsProp = true;
                break;
              }
            }
            if (isHandledAsProp) continue;
          }

          if (jsxPropNameForKey === 'style' && typeof originalHtmlAttrValue === 'string')
            attribsString += ` style={${JSON.stringify(styleStringToObject(originalHtmlAttrValue))}}`;
          else if (typeof originalHtmlAttrValue === 'boolean') {
            if (originalHtmlAttrValue)
              attribsString += ` ${attributeNameToRenderInJsx}`;
          } else if (
            originalHtmlAttrValue === '' &&
            (attributeNameToRenderInJsx === 'disabled' ||
              attributeNameToRenderInJsx === 'checked' ||
              attributeNameToRenderInJsx === 'selected' ||
              attributeNameToRenderInJsx === 'required' ||
              attributeNameToRenderInJsx === 'autoplay' ||
              attributeNameToRenderInJsx === 'controls' ||
              attributeNameToRenderInJsx === 'loop' ||
              attributeNameToRenderInJsx === 'muted' ||
              attributeNameToRenderInJsx === 'readonly' ||
              attributeNameToRenderInJsx === 'open' ||
              attributeNameToRenderInJsx === 'hidden')
          )
            attribsString += ` ${attributeNameToRenderInJsx}`;
          else
            attribsString += ` ${attributeNameToRenderInJsx}={${JSON.stringify(String(originalHtmlAttrValue))}}`;
        }
      }
      if (SELF_CLOSING_TAGS.has(tagName))
        return `<${tagName}${attribsString} />`;
      let childrenJsx;
      if (
        isComponentDefinitionBody &&
        componentPropsSpec?.children?.type === 'children'
      )
        childrenJsx = `{children}`;
      else
        childrenJsx = (node.children || [])
          .map((child, i) =>
            astNodeToJsx(
              child,
              depth + 1,
              isComponentDefinitionBody,
              componentPropsSpec,
              [...nodePath, 'children', i],
              localComponentRegistry,
              templateNodeForCurrentDefinition
            )
          )
          .join('');
      return `<${tagName}${attribsString}>${childrenJsx}</${tagName}>`;
    default:
      console.warn(
        `Unhandled AST node type: ${node.type} at path ${nodePath.join('.')}`
      );
      return '';
  }
}

// =================================================================
// === MAIN PROCESS ORCHESTRATION                              ===
// =================================================================

// --- MODIFIED: Uses constants for paths and doesn't need outputDir passed in ---
async function processSingleAst(astFilePath, pageName) {
  const localComponentRegistry = new Map();
  const importsForPage = new Set();

  // Use the global path constants instead of a passed-in variable
  await fs.ensureDir(COMPONENTS_OUTPUT_DIR);
  await fs.ensureDir(PAGES_OUTPUT_DIR);

  const ast = await fs.readJson(astFilePath);
  const rootHtmlNode = ast.children?.find(
    (c) => c.type === 'tag' && c.name === 'html'
  );
  const bodyNode = rootHtmlNode?.children?.find(
    (c) => c.type === 'tag' && c.name === 'body'
  );
  if (!bodyNode) {
    console.error(`<body> tag not found in AST ${astFilePath}.`);
    return;
  }
  const newGlobalComponentDefs = identifyComponents(
    bodyNode,
    localComponentRegistry
  );
  for (const compDef of newGlobalComponentDefs) {
    let propsList = [],
      hasChildrenProp = false;
    Object.keys(compDef.propsSpec || {}).forEach((propName) => {
      if (compDef.propsSpec[propName].type === 'children')
        hasChildrenProp = true;
      else propsList.push(propName);
    });
    let propsDestructureString = propsList.join(', ');
    if (hasChildrenProp)
      propsDestructureString +=
        (propsDestructureString ? ', ' : '') + 'children';
    let finalPropsSignature = `{ ${propsDestructureString} }`;
    if (!propsDestructureString && !hasChildrenProp) finalPropsSignature = '{}';
    const usedComponentNamesInBody = new Set();
    const componentNamePattern = /<([A-Z][A-Za-z0-9_]*)\b/g; // Modified to include underscore
    let match;
    while ((match = componentNamePattern.exec(compDef.jsxBody)) !== null)
      if (match[1] !== compDef.name) usedComponentNamesInBody.add(match[1]);

    // Assumes a flat component directory structure, so imports are relative to self.
    const componentImports = Array.from(usedComponentNamesInBody)
      .map((name) => `import ${name} from './${name}';`)
      .join('\n');
    const componentFileContent = `
            import React from 'react';
            ${componentImports}

            const ${compDef.name} = (${finalPropsSignature}) => {
              return (
                ${compDef.jsxBody}
              );
            };

            export default ${compDef.name};
        `;
    // Use the global path constant for the output file
    const componentDiskFilePath = path.join(
      COMPONENTS_OUTPUT_DIR,
      `${compDef.name}.jsx`
    );
    await formatAndWriteFile(componentDiskFilePath, componentFileContent);
    console.log(
      `Generated new component: ${componentDiskFilePath} (Type: ${compDef.type})`
    );
    globalGeneratedComponentJSXStrings.set(compDef.name, componentFileContent);
  }
  const pageJsxContent = (bodyNode.children || [])
    .map((child) =>
      astNodeToJsx(child, 0, false, {}, [], localComponentRegistry, null)
    )
    .join('');
  const usedComponentNamesOnPage = new Set();
  const pageComponentNamePattern = /<([A-Z][A-Za-z0-9_]*)\b/g; // Modified to include underscore
  let pageMatch;
  while ((pageMatch = pageComponentNamePattern.exec(pageJsxContent)) !== null)
    usedComponentNamesOnPage.add(pageMatch[1]);

  // --- NEW: Robustly calculate relative path for imports from pages to components ---
  usedComponentNamesOnPage.forEach((compName) => {
    // Calculate the relative path from the pages directory to the components directory
    const relativePath = path.relative(PAGES_OUTPUT_DIR, COMPONENTS_OUTPUT_DIR).replace(/\\/g, '/');
    importsForPage.add(`import ${compName} from '${relativePath}/${compName}';`);
  });

  const pageComponentName = toPascalCase(pageName || 'Page');
  const pageComponentFileContent = `
        import React from 'react';
        ${Array.from(importsForPage).join('\n')}

        const ${pageComponentName} = () => {
          return (
            <>
              ${pageJsxContent}
            </>
          );
        };

        export default ${pageComponentName};
    `;
  // Use the global path constant for the output file
  const pageDiskFilePath = path.join(
    PAGES_OUTPUT_DIR,
    `${pageComponentName}.jsx`
  );
  await formatAndWriteFile(pageDiskFilePath, pageComponentFileContent);
  console.log(`Generated page: ${pageDiskFilePath}`);
}

// --- MODIFIED: Uses constants for paths ---
async function main() {
  // Use global path constants for all directory operations.
  await fs.ensureDir(REACT_OUTPUT_DIR);
  // We clear the component/page directories to ensure no stale files remain
  await fs.emptyDir(COMPONENTS_OUTPUT_DIR);
  await fs.emptyDir(PAGES_OUTPUT_DIR);
  await fs.ensureDir(SVGS_OUTPUT_DIR);

  const astFiles = await fs.readdir(INPUT_ASTS_DIR);
  for (const astFile of astFiles) {
    if (astFile.endsWith('_ast.json')) {
      const astFilePath = path.join(INPUT_ASTS_DIR, astFile);
      const pageName = path.basename(astFile, '_ast.json');
      console.log(`\nProcessing AST for page: ${pageName} from ${astFile}`);
      // No longer need to pass output directory.
      await processSingleAst(astFilePath, pageName);
    }
  }
  console.log('\n--- Conversion Complete ---');
  console.log(
    `Total unique components generated: ${globalGeneratedComponentSignatures.size}`
  );
}

main().catch(console.error);