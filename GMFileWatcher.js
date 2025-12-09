import childProcess from 'child_process';
import path from 'path';
import fs from 'fs';
import chokidar from 'chokidar';
import { readFile } from 'fs/promises';

/* ---------------------------------------------------------
 * GMModule
 * --------------------------------------------------------- */
class GMModule {
  constructor(dir, version, hook = defaultWatcherHook()) {
    this.dir = dir;
    this.version = version;

    this.scriptWatcher  = this.createWatcher("src", hook);
    this.testWatcher  = this.createWatcher("test", hook);
    this.shaderWatcher  = this.createWatcher("resource/shader", hook);

    this.objectWatchers = this.findTopFolders(path.join(dir, "resource/object"))
      .map(entry => ({
        ...entry,
        watcher: chokidar.watch(entry.dir, hook)
      }));

    this.sceneWatchers = this.findTopFolders(path.join(dir, "resource/scene"))
      .map(entry => ({
        ...entry,
        watcher: chokidar.watch(entry.dir, hook)
      }));

    console.log(`♻️  Watching ${dir} for changes...`);
  }

  createWatcher(subdir, hook) {
    return chokidar.watch(path.join(this.dir, subdir), hook);
  }

  findTopFolders(dir, results = []) {
    if (!fs.existsSync(dir)) return results;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const gmlFiles = entries
      .filter(e => e.isFile() && e.name.endsWith(".gml"))
      .map(e => e.name);

    if (gmlFiles.length > 0) {
      results.push({
        name: path.basename(dir),
        dir: dir.replace(/^\.\//, ""),
        files: gmlFiles,
      });
      return results;
    }

    entries
      .filter(e => e.isDirectory())
      .forEach(subdir => this.findTopFolders(path.join(dir, subdir.name), results));

    return results;
  }
}

function defaultWatcherHook() {
  return {
    ignored: /[\/\\]\./,
    persistent: true,
    ignoreInitial: true,
    depth: 99,
  };
}

/* ---------------------------------------------------------
 * GMFileWatcher
 * --------------------------------------------------------- */
class GMFileWatcher {
  constructor(gmPackage, modulesDir, watch = false) {
    this.gmPath = resolvePath(gmPackage.main);
    this.modulesDirName = modulesDir;
    this.modulesDirPath = resolvePath(modulesDir);

    const dependencyEntries = Object.entries(gmPackage.dependencies);

    this.modules = watch
      ? this.initializeWatchedModules(dependencyEntries)
      : this.initializeSyncModules(dependencyEntries);
  }

  initializeWatchedModules(dependencies) {
    return dependencies.map(([name, version]) => {
      const gmModule = this.parseModule(name, version);
      this.syncModuleFiles(name, gmModule.dir, gmModule.objectWatchers, gmModule.sceneWatchers);
      return gmModule;
    });
  }

  initializeSyncModules(dependencies) {
    dependencies.forEach(([name]) => {
      const modulePath = path.join(this.modulesDirPath, name);
      this.syncModuleFiles(name, modulePath);
    });
    return [];
  }

  /* ---------------------------------------------
   * Sync helpers
   * --------------------------------------------- */
  syncModuleFiles(name, moduleDir, objectWatchers = [], sceneWatchers = []) {
    const src      = path.join(moduleDir, 'src');
    const test     = path.join(moduleDir, 'test');
    const shader   = path.join(moduleDir, 'resource/shader');

    this.syncFiles(src,     this.gmPath, `${name}/src`,               'scripts', 'gml');
    this.syncFiles(test,    this.gmPath, `${name}/test`,              'scripts', 'gml');
    this.syncFiles(shader,  this.gmPath, `${name}/resource/shader`,   'scripts', 'gml');
    this.syncFiles(shader,  this.gmPath, `${name}/resource/shader`,   'shaders', 'fsh');
    this.syncFiles(shader,  this.gmPath, `${name}/resource/shader`,   'shaders', 'vsh');

    objectWatchers?.forEach(entry => {
      this.syncFiles(
        entry.dir,
        path.join(this.gmPath, 'objects', entry.name),
        `${name}/resource/object/../${entry.name}`,
        `objects/${entry.name}`,
        'gml',
        '/.*',
        true
      );
    });

    sceneWatchers?.forEach(entry => {
      this.syncFiles(
        entry.dir,
        path.join(this.gmPath, 'rooms', entry.name),
        `${name}/resource/scene/${entry.name}`,
        `rooms/${entry.name}`,
        'gml',
        '/.*',
        true
      );
    });
  }

  syncFiles = function (source, target, pkgName, gmFolderName, extension, suffix = '/../*.', isObject = false) {
    childProcess.exec(`find ${source} -iname "*.${extension}"`, (err, stdout) => {
      const loc = stdout.split('\n')
        .filter(Boolean)
        .map(f => this.readFileMetadata(f, extension))
        .map(script => this.writeIfChanged(script, extension, target, gmFolderName, isObject))
        .reduce(sumLineChanges, { before: 0, after: 0 });

      logSyncSummary(pkgName, suffix, extension, loc);
    });
  }

  /* ---------------------------------------------
   * Watcher handlers
   * --------------------------------------------- */
  parseModule(name, version) {
    const gmModule = new GMModule(resolvePath(path.join(this.modulesDirName, name)), version);

    const moduleFilter = (p, module) =>
      path.normalize(p).includes(path.normalize(module.dir));

    gmModule.scriptWatcher.on('change', p => this.modules.filter(m => moduleFilter(p, m)).forEach(() => this.hook(p)));
    gmModule.testWatcher.on('change', p => this.modules.filter(m => moduleFilter(p, m)).forEach(() => this.hook(p)));
    gmModule.shaderWatcher.on('change', p => this.modules.filter(m => moduleFilter(p, m)).forEach(() => this.hook(p)));

    gmModule.objectWatchers.forEach(entry => {
      entry.watcher.on('change', () => this.objectHook(entry));
    });

    gmModule.sceneWatchers.forEach(entry => {
      entry.watcher.on('change', () => this.sceneHook(entry));
    });

    return gmModule;
  }

  async hook(p) {
    const pkgName = extractPkgName(p, this.modulesDirName);
    const source = path.join(this.modulesDirPath, pkgName);

    this.syncModuleFiles(pkgName, source);
  }

  async objectHook(entry) {
    this.syncFiles(
      entry.dir,
      path.join(this.gmPath, 'objects', entry.name),
      `${this.modulesDirName}/resource/object/../${entry.name}`,
      `objects/${entry.name}`,
      'gml',
      '/.*',
      true
    );
  }

  async sceneHook(entry) {
    this.syncFiles(
      entry.dir,
      path.join(this.gmPath, 'rooms', entry.name),
      `${this.modulesDirName}/resource/scene/${entry.name}`,
      `rooms/${entry.name}`,
      'gml',
      '/.*',
      true
    );
  }

  readFileMetadata(filePath, extension) {
    return {
      name: path.basename(filePath).replace(`.${extension}`, ''),
      dir: path.normalize(filePath.replaceAll('./', '')),
      content: fs.readFileSync(path.normalize(filePath), 'utf8'),
    };
  }

  writeIfChanged(script, extension, target, gmFolderName, isObject) {
    const dst = isObject
      ? path.join(target, `${script.name}.${extension}`)
      : path.join(target, gmFolderName, `${script.name}/${script.name}.${extension}`);

    const existing = fs.readFileSync(dst, 'utf8');

    if (existing !== script.content) {
      console.log(`➡️  Save ${script.name}.${extension}`);
      fs.writeFileSync(dst, script.content, { encoding: 'utf8', flag: 'w' });
    }

    return {
      before: existing.split('\n').length,
      after: script.content.split('\n').length,
    };
  }
}

/* ---------------------------------------------------------
 * Helpers (pure functions)
 * --------------------------------------------------------- */
function resolvePath(p) {
  return path.join(process.cwd(), path.normalize(p));
}

function extractPkgName(file, modulesDir) {
  return file
    .split(modulesDir)[1]
    .replaceAll('\\', '/')
    .split('/')
    .filter(Boolean)[0];
}

function sumLineChanges(acc, cur) {
  acc.before += cur.before;
  acc.after += cur.after;
  return acc;
}

function logSyncSummary(pkgName, suffix, extension, loc) {
  const timestamp = new Intl.DateTimeFormat('pl-PL', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date()).replaceAll(',', '');

  console.log(
    `⌚ ${timestamp} [${pkgName}${suffix}${extension}]`,
    { new: loc.after - loc.before, sum: loc.after }
  );
}

/* ---------------------------------------------------------
 * Public API
 * --------------------------------------------------------- */
export async function watch(gmPackagePath, modulesDir = 'gm_modules') {
  try {
    return new GMFileWatcher(
      JSON.parse(await readFile(gmPackagePath, 'utf8')),
      modulesDir,
      true
    );
  } catch (e) {
    console.error(`❌ Unable to parse package-gm.json at: ${gmPackagePath}\n${e.message}`);
    console.error(e.stack);
  }
}

export async function sync(gmPackagePath, modulesDir = 'gm_modules') {
  try {
    return new GMFileWatcher(
      JSON.parse(await readFile(gmPackagePath, 'utf8')),
      modulesDir
    );
  } catch (e) {
    console.error(`❌ Unable to parse package-gm.json at: ${gmPackagePath}\n${e.message}`);
    console.error(e.stack);
  }
}
