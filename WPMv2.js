/**
 * WPMv2 - Webstrate Package Manager
 * 
 * Copyright 2019 Rolf Bagge, Janus Bager Kristensen,
 * CAVI - Center for Advanced Visualisation and Interaction,
 * Aarhus University
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 * 
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/

/* global Promise, webstrate, eval */

//Encapsulate WPMv2, so we can decide which methods are public
((window) => {

    const WPM_ALIASES = "WPM.repoAliases";

    let runningRequiresPromiseMap = [];

    let allInstalledCallbacksStack = [];

    const requireQueue = [];

    /**
     * WebstratePackageManager version 2
     *
     * It is used to install WPM packages into webstrates.
     *
     * <pre><code>WPMv2.require([
     *      {package: "somePackageName", repository: "/somewebstraterepo"},
     *      {package: "someOtherPackageName", repository: "/somewebstraterepo"}
     * ]).then(()=>{
     *     //Packages are now installed
     * });
     * </code></pre>
     * @hideconstructor
     */
    class WPMv2 {
        static async bootstrap(packageDom, options, requireToken, triggerOnPackageInstalled = false) {
            let wpmPackage = WPMv2.getWPMPackageFromDOM(packageDom);
            let promises = [];

            /**
             * @class WPMInterface
             * @classdesc
             * Internal WPM interface that is provided for every package that is installed via WPMv2. Is accessed as just wpm, when inside package code.
             * @hideconstructor
             * @memberof WPMv2
             */
            let wpmInterface = {};

            /**
             * Reads metadata from the given package. If no packagename is given, metadata from the current package is read.
             *
             * @example
             * let metadata = wpm.readMetadata();
             *
             * @param {string} [packageName] - The package to read metadata from
             * @returns {json}
             * @memberof WPMv2.WPMInterface
             * @name readMetadata
             * @method
             */
            wpmInterface.readMetadata = (packageName = null) => {
                if (packageName == null) {
                    packageName = packageDom.getAttribute("id");
                }

                return WPMv2.readMetadata(packageName);
            };

            /**
             * Registers a callback to be called when this package is installed.
             *
             * @example
             * wpm.onInstalled(()=>{
             *     //Package is now installed
             * });
             *
             * @param {method} callback
             * @memberof WPMv2.WPMInterface
             * @name onInstalled
             * @method
             */
            wpmInterface.onInstalled = (callback) => {
                packageDom.addEventListener("wpm.packageInstalled", callback, {"once": true});
            };

            /**
             * Registers a callback to be called when all packages are installed. (When installing multiple packages at the same time.)
             *
             * @example
             * wpm.onAllInstalled(()=>{
             *     //All packages are installed
             * });
             *
             * @param {method} callback
             * @memberof WPMv2.WPMInterface
             * @name onAllInstalled
             * @method
             */
            wpmInterface.onAllInstalled = (callback) => {
                //Retrieve from stack
                let allInstalledCallbacks = allInstalledCallbacksStack[allInstalledCallbacksStack.length-1];
                if (allInstalledCallbacks){
                    allInstalledCallbacks.push(callback);
                } else {
                    // STUB: Remove FIXME if ok
                    console.log("FIXME: WPMv2 - No allInstalledCallbacks in allInstalledCallbacksStack, assuming no more packages? Is this ok?");
                    // Immediately call the callback since no more packages are left
                    callback();
                }
                
            };

            /**
             * Registers a callback to be called when this package is removed.
             *
             * @example
             * wpm.onRemoved(({detail: packageName})=>{
             *     //Package is removed, packageName is provided for ease of access, will be same as the package this callback was registered from.
             * });
             *
             * @param {method} callback
             * @memberof WPMv2.WPMInterface
             * @name onRemoved
             * @method
             */
            wpmInterface.onRemoved = (callback) => {
                packageDom.addEventListener("wpm.packageRemoved", callback, {"once": true});
            };

            /**
             * Registers a callback to be called when any package is removed.
             *
             * @example
             * wpm.onRemovedAny(({detail: packageName})=>{
             *      //Package with name "packageName" has been removed
             * });
             *
             * @param {method} callback
             * @memberof WPMv2.WPMInterface
             * @name onRemovedAny
             * @method
             */
            wpmInterface.onRemovedAny = (callback) => {
                document.addEventListener("wpm.packageRemovedAny", callback);
            };

            wpmInterface.require = async (packageRequests, extraOptions) => {
                let convertedPackages = [];

                if (packageRequests != null) {
                    if (!Array.isArray(packageRequests)) {
                        packageRequests = [packageRequests];
                    }

                    for (let packageRequest of packageRequests) {
                        if (typeof packageRequest === "string") {
                            //Shorthand for requiring dependency, lookup in our descriptor
                            let packageName = packageRequest;
                            let repo = wpmPackage.optionalDependencyMap.get(packageName);

                            convertedPackages.push({
                                package: packageName,
                                repository: repo
                            });
                        } else {
                            convertedPackages.push(packageRequest);
                        }
                    }
                } else {
                    //packages == null, means require all dependencies!
                    wpmPackage.optionalDependencyMap.forEach((repo, packageName) => {
                        convertedPackages.push({
                            package: packageName,
                            repository: repo
                        });
                    });
                }

                const combinedOptions = Object.assign({}, options, extraOptions);

                promises.push(WPMv2.require(convertedPackages, combinedOptions, requireToken));

                return Promise.all(promises);
            };

            async function loadExternalCSS(response) {
                let styleContent = await response.text();

                //Attempt linking stylesheets instead of inlining them
                let style = document.createElement("style");

                let transient = document.createElement("transient");
                transient.appendChild(style);

                //Disable sourcemap

                styleContent = styleContent.replace(/\/\*#\s*sourceMappingURL=\S+\s*\*\//, "");
                //styleContent = styleContent.replace(/\/\/#\s*sourceMappingURL=\S+/, "");

                style.innerHTML = styleContent;

                document.head.append(transient);
            }

            async function loadExternalJS(response) {
                let scriptContent = await response.text();

                //Hack to make requirejs work, and be able to hide it
                const origDefine = window.define;
                if (window.define != null) {
                    window.define = undefined;
                }

                //Disable sourcemap
                //scriptContent = scriptContent.replace(/\/\*#\s*sourceMappingURL=\S+\s*\*\//, "");
                scriptContent = scriptContent.replace(/\/\/# sourceMappingURL=\S+/, "");

                eval.call(null, scriptContent);

                //Restore previous define, if this script did not set define
                if (window.define == null && origDefine != null) {
                    window.define = origDefine;
                }
            }

            /**
             * Fetches and evaluates external javascript, or loads css.
             *
             * The server response header Content-Type will be used to determine if its a JS or CSS.
             *
             * @example
             * await wpm.requireExternal("https://some.site.com/someScript.js");
             * //someScript.js has now been parsed and evaluated
             *
             * @param {string|string[]} urls - The URLs to the wanted JS, CSS
             * @returns {Promise<void>} - Resolves when all scripts/styles are fetched and evaluated/loaded
             * @memberof WPMv2.WPMInterface
             * @name requireExternal
             * @method
             */
            wpmInterface.requireExternal = async (urls) => {
                if(!(urls instanceof Array)) {
                    urls = [urls];
                }

                for(let url of urls) {

                    let promise = new Promise(async (resolve, reject)=>{
                        try {
                            let response = await fetch(url, {credentials: 'same-origin'});

                            let contentType = response.headers.get("Content-Type").trim();
                            let indexOfSemicolon = contentType.indexOf(";");
                            if (indexOfSemicolon !== -1) {
                                contentType = contentType.substring(0, indexOfSemicolon).trim();
                            }

                            switch (contentType) {
                                case "text/css": {
                                    await loadExternalCSS(response);
                                    break;
                                }
                                case "text/javascript":
                                case "application/javascript":
                                case "application/x-javascript": {
                                    await loadExternalJS(response);
                                    break;
                                }
                                default:
                                    console.warn("Unhandled contentType:", contentType, url);
                                    console.warn("Loading unknown as JS for know. please report...")
                                    await loadExternalJS(response);
                            }
                            resolve();
                        } catch(e) {
                            reject("Unable to fetch: "+url);
                        }
                    });

                    //promises.push(promise);

                    await promise;
                }
            };

            let scripts = packageDom.querySelectorAll("script[type='disabled']");

            for (let i = 0; i < scripts.length; i++) {
                let script = scripts[i];

                let scriptContent = "";

                if (script.src != null && script.src.length > 0) {
                    let response = await fetch(script.src, {credentials: 'same-origin'});
                    scriptContent = await response.text();
                } else {
                    scriptContent = script.innerText;
                }
                
                scriptContent = 'try{'+scriptContent+'} catch (ex){console.error("Bootstrap runtime error in '+packageDom.getAttribute("id").replaceAll("'","")+':", ex);}';

                const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

                try {
                    let functionArgs = [];
                    functionArgs.push("wpm");

                    let functionArgValues = [];
                    functionArgValues.push(wpmInterface);

                    if(options.context != null) {
                        const contextKeys = Object.keys(options.context);
                        functionArgs.push(...contextKeys);

                        const contextValues = Object.values(options.context);
                        functionArgValues.push(...contextValues);
                    }

                    let wpmEval = new AsyncFunction(...functionArgs, scriptContent);
                    await wpmEval(...functionArgValues);
                } catch (e) {
                    console.error("Bootstrap parse error in " + packageDom.getAttribute("id"), e);
                }
            }

            await Promise.all(promises);

            if (triggerOnPackageInstalled) {
                packageDom.dispatchEvent(new CustomEvent("wpm.packageInstalled"));
            }
        }

        /**
         * Installs all packages at the given repository into the current page
         *
         * @example
         * WPMv2.requireAll("https://some.site.com/myRepo");
         *
         * @param {string} repository - The repository to lookup packages from
         * @param {WPMv2~PackageOptions} options - options to use for overriding packages options, also applies for dependencies
         * @returns {Promise<void>} - Resolved when packages are installed
         */
        static async requireAll(repository, options = {}) {
            let packages = [];

            let wpmPackages = await WPMv2.getPackagesFromRepository(repository);

            wpmPackages.forEach((pkg) => {
                if(options.blacklist != null && options.blacklist instanceof Array && options.blacklist.includes(pkg.name)) {
                    //Skip this package
                    return;
                }
                
                let pkgOptions = {
                    repository: pkg.repository,
                    package: pkg.name
                };
                packages.push(pkgOptions);
            });

            return WPMv2.require(packages, options);
        }

        /**
         * @typedef {Object} WPMv2~PackageOptions
         * @property {string} [repository] - The repository to lookup the package inside. If left unset, the current page is used.
         * @property {HTMLElement|string} [appendTarget] - The dom node to append to. If a string, will be looked up by document.querySelector(appendTarget). Defaults to a transient div inside document.head
         * @property {('append'|'before'|'after'|'prepend')} [appendMethod] - How to append to the appendTarget. Defaults to 'append'.
         */

        /**
         * @typedef {Object} WPMv2~PackageJson
         * @property {string} package - The name of the package
         * @property {string} [repository] - The repository to lookup the package inside. If left unset, the current page is used.
         * @property {HTMLElement|string} [appendTarget] - The dom node to append to. If a string, will be looked up by document.querySelector(appendTarget). Defaults to a transient div inside document.head
         * @property {('append'|'before'|'after'|'prepend')} [appendMethod] - How to append to the appendTarget. Defaults to 'append'.
         */

        /**
         *
         * @param {WPMv2.WPMPackage[]}packages
         * @returns {Promise<void>}
         */
        static async findCompletePackageTreeSorted(packages = [], defaultOptions, overrideOptions = {}) {
            const numPackages = packages.length;

            if (!Array.isArray(packages)) {
                packages = [packages];
            }

            let alreadySorting = [];
            let convertedPackages = [];

            async function addRepo(repoUrl, options) {
                if(overrideOptions.repository != null) {
                    console.warn("Adding a full repository, does not atm support overriding options for repository...");
                }
                
                try {
                    let packages = await WPMv2.getPackagesFromRepository(repoUrl);
                    for(let pkg of packages) {
                        if(options != null) {
                            pkg.updateFromOptions(options);
                        }
                        await addPackage(pkg);
                    }
                } catch (ex){
                    console.error("WPMv2 very important error: Could not resolve repository. This will probably cause the site to fail horribly! ", repoUrl, ex);
                }
            }

            async function addPackage(wpmPackage) {
                //Check if package is in local dom
                let localPackageDom = document.querySelector(".packages .package#" + wpmPackage.name + ", wpm-package#" + wpmPackage.name);
                let repoOverride = wpmPackage.repository;
                if(localPackageDom != null) {
                    //Local package exists, override repository with local ? This breaks dependencies that are "same repository", since they now lookup on the local repository.
                    //Not setting local repository, makes the update from dom, happen on the non embedded version, which is also wrong?
                    //wpmPackage.repository = WPMv2.getLocalRepositoryURL();
                    repoOverride = WPMv2.getLocalRepositoryURL();
                }

                let name = WPMv2.getName(wpmPackage);
                if(!alreadySorting.includes(name)){
                    alreadySorting.push(name);
                    try {
                        wpmPackage = await WPMv2.getLatestPackageFromPackage(wpmPackage, repoOverride);
                        let dependencies = await WPMv2.findAllDependencies(wpmPackage, Object.assign({}, overrideOptions));

                        for(let dependency of dependencies) {
                            await addPackage(dependency);
                        }
                        convertedPackages.push(wpmPackage);
                    } catch (ex){
                        console.error("WPMv2 very important error: Could not resolve package. This will probably cause the site to fail horribly! ", wpmPackage, ex);
                    }
                }
            }
            
            // Resolve all the packages
            await Promise.all(packages.map(async (pkg)=>{
                let wpmPackage = null;
                if (pkg instanceof WPMPackage) {
                    //Already a WPMPackage
                    wpmPackage = pkg;
                    wpmPackage.updateFromOptions(overrideOptions);
                } else if(typeof pkg === "string") {
                    if(pkg.startsWith("http") || (pkg.startsWith("/") && pkg.indexOf(" ") === 0)) {
                        //Full repository, http(s)://myrepourl or /my-relative-url
                        await addRepo(pkg);
                        return;
                    } else {
                        //Single package, name or including repository
                        let split = pkg.split(" ");

                        if(split.length === 1) {
                            //Single local package
                            let options = Object.assign({}, defaultOptions, {
                                "package": split[0]
                            }, overrideOptions);
                            wpmPackage = new WPMPackage(options.package, options.repository);
                            wpmPackage.updateFromOptions(options);
                        } else if(split.length === 2) {
                            //Single package from given repository
                            let options = Object.assign({}, defaultOptions, {
                                "package": split[1].replace("#", ""),
                                "repository": split[0]
                            }, overrideOptions);
                            wpmPackage = new WPMPackage(options.package, options.repository);
                            wpmPackage.updateFromOptions(options);
                        } else {
                            console.warn("Unable to parse package from string:", pkg);
                        }
                    }
                } else {
                    if(pkg.repository != null && pkg.package != null) {
                        //Full package, add
                        let options = Object.assign({}, defaultOptions, pkg, overrideOptions);
                        wpmPackage = new WPMPackage(options.package, options.repository);
                        wpmPackage.updateFromOptions(options);
                    } else if(pkg.repository != null) {
                        //Full repo, add all
                        await addRepo(pkg.repository, pkg);
                        return;
                    }
                }

                if(wpmPackage != null) {
                    await addPackage(wpmPackage);
                } else {
                    console.log("Was null:", pkg);
                }
            }));

            const sortedPackages = [];
            let lastLength = convertedPackages.length;
            while(convertedPackages.length > 0) {
                let packagesWithDependenciesInstalled = convertedPackages.filter((pkg)=>{
                    let ready = true;

                    for(let dep of pkg.dependencyMap) {
                        //If any dependency is not sorted to be installed yet, this is not ready
                        if(!WPMv2.hasPackage(sortedPackages, {"package": dep[0]})) {
                            ready = false;
                            break;
                        }
                    }
                    for(let dep of pkg.optionalDependencyMap) {
                        //If not already sorted to be installed, and among packages to install, this is not ready yet
                        if(!WPMv2.hasPackage(sortedPackages, {"package": dep[0]}) && WPMv2.hasPackage(convertedPackages, {"package": dep[0]})) {
                            ready = false;
                            break;
                        }
                    }

                    return ready;
                });

                packagesWithDependenciesInstalled.forEach((pkg)=>{
                    sortedPackages.push(pkg);
                    convertedPackages.splice(convertedPackages.indexOf(pkg), 1);
                });

                if(convertedPackages.length === lastLength) {
                    console.warn("Not able to add any more packages:", convertedPackages);
                    break;
                }
                lastLength = convertedPackages.length;
            }

            return sortedPackages;
        }

        /**
         * Finds all dependencies of a package
         * @param pkg
         * @returns {Promise<WPMv2.WPMPackage[]>}
         * @private
         */
        static async findAllDependencies(pkg, overrideOptions = {}) {
            let dependencies = [];

            for(let dependencyEntry of pkg.dependencyMap) {
                let dependency = new WPMPackage(dependencyEntry[0], dependencyEntry[1]);
                dependency.updateFromOptions(overrideOptions);
                dependencies.push(dependency);
            }

            return dependencies;
        }

        /**
         * Checks if the given array, contains the given package
         * @private
         */
        static hasPackage(packages, searchPackage) {
            return packages.find((pkg)=>{
                let pkgName = WPMv2.getName(pkg);
                let searchPackageName = WPMv2.getName(searchPackage);

                if(pkgName == null || searchPackageName == null) {
                    console.warn("Unable to compare as one was null");
                    return false;
                }

                return pkgName === searchPackageName;
            }) != null;
        }
        
        static getName(searchPackage){
            if(searchPackage instanceof WPMPackage) {
                return searchPackage.name;
            } else if(searchPackage.package != null) {
                return searchPackage.package;
            } else {
                console.warn("Unable to infer package name from:", searchPackage);
                return null;
            }            
        }

        /**
         * Installs the given packages into the current document
         *
         * Override options set in overrideOptions, override the options given in packages.
         *
         * @example
         * WPMv2.require([{package: "myPackage", repository: "myRepositoryUrl"}]);
         *
         * @param {WPMv2.WPMPackage[]|WPMv2.WPMPackage|WPMv2~PackageJson[]|WPMv2~PackageJson} packages - the packages to install
         * @param {WPMv2~PackageOptions} overrideOptions - options to use for overriding packages options, also applies for dependencies
         * @returns {Promise<void>} - Resolves when the packages are done installing
         */
        static async require(packages = [], overrideOptions = {}, givenRequireToken = null) {
            const defaultOptions = {
                repository: WPMv2.getLocalRepositoryURL(),
                appendMethod: "append",
                appendTarget: null,
                bootstrap: true
            };

            //Make sure we dont override package
            if(overrideOptions.hasOwnProperty("package")) {
                console.warn("Overriding package...", overrideOptions);
                delete overrideOptions.package;
            }

            const completePackageTreeSorted = await WPMv2.findCompletePackageTreeSorted(packages, defaultOptions, overrideOptions);

            if (packages.length === 0) {
                return;
            }

            let requireToken = givenRequireToken;

            let timerId = [...Array(10)].map(_ => (Math.random() * 36 | 0).toString(36)).join``;
            let requireTimerId = "Require time [" +timerId +"]";

            if (givenRequireToken == null) {
                allInstalledCallbacksStack.push([]);
                requireToken = {};
                console.time(requireTimerId);
            }

            // Schedule all the package promises in parallel, but keep track of package inter-dependencies too
            let packagePromiseMap = new Map();

            //Save the currently running require
            runningRequiresPromiseMap.push(packagePromiseMap);

            for (let pkg of completePackageTreeSorted) {
                // At this point, since the tree is sorted, a dependency is either hard and supposed to be in the tree or soft and maybe in the tree (if not, then not installed)
                // If the depedency is hard and not in the tree then a missing package error has already happened and we are going by best-effort anyways, so ignore this case.

                //Check for another require already promising to install this package
                let foundPromise = null;
                for(let promiseMap of runningRequiresPromiseMap) {
                    if(promiseMap.has(pkg.name)) {
                        //Use other require promise, to tell us when package is installed
                        foundPromise = promiseMap.get(pkg.name);
                        break;
                    }
                }

                if(foundPromise != null) {
                    packagePromiseMap.set(pkg.name, foundPromise);
                } else {

                    packagePromiseMap.set(pkg.name, async function multithreadedFetchPackage() {
                        // Lookup all hard and optional dependencies and wait for them before starting ours
                        await Promise.all([...pkg.dependencyMap.keys(), ...pkg.optionalDependencyMap.keys()].map((dependency) => {
                            return packagePromiseMap.get(dependency);
                        }));

                        // Install this package
                        let options = Object.assign({}, defaultOptions, pkg.getPackageOptions(), overrideOptions);

                        //Check if package is in dom
                        let packageDom = document.querySelector(".packages .package#" + pkg.name + ", wpm-package#" + pkg.name);

                        let alreadyInstalled = false;

                        let wpmPackage = null;

                        let needsAppending = false;

                        if (packageDom == null) {
                            //We need to fetch and install package to dom
                            let fetchedPackageDom = await WPMv2.getPackageDOM(pkg.repository, pkg.name);

                            //Rewrite packageDom to a wpm-package
                            packageDom = document.createElement("wpm-package");

                            for (let index = fetchedPackageDom.attributes.length - 1; index > -1; --index) {
                                let attribute = fetchedPackageDom.attributes[index];
                                packageDom.setAttribute(attribute.name, attribute.value);
                            }

                            // Instead of display:none, hide it otherwise due to Chrome bug for SVGs
                            packageDom.style.width = 0;
                            packageDom.style.height = 0;
                            packageDom.style.position = "absolute";
                            packageDom.style.visibility = "hidden";

                            Array.from(fetchedPackageDom.children).forEach((child) => {
                                packageDom.appendChild(child);
                            });

                            WPMv2.stripProtection(packageDom);

                            wpmPackage = WPMv2.getWPMPackageFromDOM(packageDom);

                            needsAppending = true;
                        } else {
                            wpmPackage = WPMv2.getWPMPackageFromDOM(packageDom);
                            alreadyInstalled = true;
                        }

                        //Install into page
                        if (needsAppending) {
                            let appendTarget = options.appendTarget;

                            if (typeof appendTarget === "string") {
                                appendTarget = document.querySelector(appendTarget);
                            }

                            if (appendTarget == null) {
                                appendTarget = document.createElement("div");
                                appendTarget.setAttribute("transient-element", "");
                                appendTarget.setAttribute("transient-wpmid", packageDom.id);
                                document.head.appendChild(appendTarget);
                            }

                            switch (options.appendMethod.toLowerCase()) {
                                case "before":
                                    appendTarget.parentNode.insertBefore(packageDom, appendTarget);
                                    break;

                                case "after":
                                    appendTarget.parentNode.insertBefore(packageDom, appendTarget.nextSibling);
                                    break;
                                case "prepend":
                                    appendTarget.prepend(packageDom);
                                    break;

                                case "append":
                                default:
                                    appendTarget.append(packageDom);
                            }

                            // POST all assets to the target
                            if (wpmPackage.assets.length > 0) {
                                let repoAssetsUrl = WPMv2.lookupRepoAlias(wpmPackage.repository);
                                let repoAssets = await WPMv2.fetchAssets(repoAssetsUrl);

                                let localAssetsUrl = location.pathname + "?assets&latest";
                                let localAssets = await WPMv2.fetchAssets(localAssetsUrl);

                                let formData = new FormData();
                                let assetPromises = [];
                                wpmPackage.assets.forEach(function (asset) {
                                    //If we already have same filehash of this asset, skip
                                    let localAsset = localAssets.get(asset);
                                    let repoAsset = repoAssets.get(asset);

                                    if (localAsset != null && repoAsset != null && localAsset.fileHash === repoAsset.fileHash) {
                                        return;
                                    }

                                    assetPromises.push(new Promise(async function (resolve, reject) {
                                        let blob = await WPMv2.fetchAsset(repoAssetsUrl, asset);

                                        // Fetch it and append to POST
                                        formData.append("file", blob, asset);
                                        resolve();
                                    }));
                                });

                                if (assetPromises.length > 0) {
                                    await Promise.all(assetPromises);

                                    await fetch(location.pathname, {
                                        body: formData,
                                        credentials: 'same-origin',
                                        method: "post"
                                    });
                                }
                            }
                        }

                        //Check if package is live
                        if (packageDom.getAttribute("transient-wpm-live") == null) {
                            if(pkg.bootstrap) {
                                //Make package live
                                await WPMv2.bootstrap(packageDom, overrideOptions, requireToken, !alreadyInstalled);

                                packageDom.setAttribute("transient-wpm-live", "");
                            } else {
                                //Ignore
                            }
                        } else {
                            //Already live
                        }
                    }());
                }
            }

            // Wait for all packages to finish installation
            await Promise.all(Array.from(packagePromiseMap.values()));

            //Splice the finished require away
            runningRequiresPromiseMap.splice(runningRequiresPromiseMap.indexOf(packagePromiseMap), 1);

            //Only the first outer call to require, has givenAllInstalledCallbacks set to null
            if (givenRequireToken === null) {
                let allInstalledCallbacks = allInstalledCallbacksStack.pop();
                console.timeEnd(requireTimerId);

                let allInstalledTimerId = "All Installed [" + timerId + "]";

                console.time(allInstalledTimerId);
                for(let allInstalledCallback of allInstalledCallbacks) {
                    await allInstalledCallback();
                }
                console.timeEnd(allInstalledTimerId);
            }
        }

        /**
         * Get the package data based on the package DOM node
         * 
         * @param {Node} packageDOM the package dom node
         * @returns {WPMPackage} the package
         * @ignore
         */
        static getWPMPackageFromDOM(packageDOM) {
            try {
                let name = packageDOM.getAttribute("id");

                let descriptorDom = packageDOM.querySelector("script[type='descriptor'], wpm-descriptor");

                if (descriptorDom !== null) {                    
                    try {
                        let packageJson = JSON.parse(descriptorDom.textContent);
                        let repository = packageDOM.getAttribute("data-repository");

                        if(repository == null) {
                            repository = WPMv2.getLocalRepositoryURL();
                        }

                        return new WPMPackage(name, repository, packageJson);
                    } catch (e){
                        console.error("Erroneous package descriptor", e, descriptorDom.textContent, packageDOM);
                    }
                } else {
                    console.error("Missing package descriptor: ", packageDOM);
                }
            } catch (e) {
                console.error(e);
            }
        }

        static getLocalRepositoryURL() {
            return location.origin + location.pathname + "?raw";
        }

        /**
         * Retrieve the package dom from a repository
         * 
         * @param {String} repository the repository to retrieve from
         * @param {String} packageName the package to retrieve
         * @returns {Node} the package dom node
         * @ignore
         */
        static async getPackageDOM(repository, packageName) {
            let dom = null;

            if(repository == this.getLocalRepositoryURL()) {
                dom = document.querySelector("html");
            } else {
                dom = await WPMv2.fetchDom(repository);
            }

            let packageDOMSource = dom.querySelector(".packages .package#" + packageName + ", wpm-package#" + packageName);
            if (packageDOMSource === null) {
                throw new Error("Invalid package '" + packageName + "' specified, no such package in repository '" + repository + "'");
            }

            let packageDOM = packageDOMSource.cloneNode(true);
            if(!packageDOM.hasAttribute("data-repository")) {
                packageDOM.setAttribute("data-repository", repository);
            }

            return packageDOM;
        }

        /**
         * Get an array of all packages that is currently installed in the dom
         *
         * @example
         * let installedPackages = WPMv2.getCurrentlyInstalledPackages();
         *
         * @returns {WPMv2.WPMPackage[]}
         */
        static getCurrentlyInstalledPackages() {
            let packages = [];

            document.querySelectorAll(".packages .package, wpm-package").forEach(function (v) {
                packages.push(WPMv2.getWPMPackageFromDOM(v));
            });

            return packages;
        }

        /**
         * Retrieve the latest package data from the original repository this package is from
         *
         * @example
         * WPMv2.getCurrentlyInstalledPackages().forEach((pkg)=>{
         *     let package = WPMv2.getLatestPackageFromPackage(pkg);
         *     //package now holds the latest data retrieved from the original repo it was installed from: like version, dependencies, changelog etc.
         * });
         *
         * @param {WPMv2.WPMPackage} p - The package to update package data for
         * @returns {Promise<WPMv2.WPMPackage>}
         */
        static async getLatestPackageFromPackage(p, repoOverride=null) {
            let fetchRepository = p.repository;
            if(repoOverride != null) {
                fetchRepository = repoOverride;
            }
            let packageDOM = await WPMv2.getPackageDOM(fetchRepository, p.name);

            let updatedPackage = WPMv2.getWPMPackageFromDOM(packageDOM);

            updatedPackage.updateFromOptions(p.getPackageOptions());

            return updatedPackage;
        }

        /**
         * Find all packages at a repository
         *
         * @example
         * WPMv2.getPackagesFromRepository("some.site.com/myRepo").then((packages)=>{
         *     console.log("Packages at repo:");
         *     packages.forEach((pkg)=>{
         *         console.log(pkg);
         *     }):
         * });
         *
         * @param {String} repositoryUrl the repository to search
         * @returns {Promise<WPMv2.WPMPackage[]>} the packages found
         */
        static async getPackagesFromRepository(repositoryUrl) {
            let packages = [];

            let dom = await WPMv2.fetchDom(repositoryUrl);

            dom.querySelectorAll(".packages .package, wpm-package").forEach(function (v) {
                if(!v.hasAttribute("data-repository")) {
                    v.setAttribute("data-repository", repositoryUrl);
                }
                packages.push(WPMv2.getWPMPackageFromDOM(v));
            });

            return packages;
        }

        static readMetadata(packageName) {
            let packageDom = document.querySelector(".packages .package#" + packageName + ", wpm-package#" + packageName);

            if(packageDom != null) {
                let metadataDom = packageDom.querySelector("script[type='descriptor'], wpm-descriptor");

                if (metadataDom != null) {
                    return JSON.parse(metadataDom.textContent);
                }
            }
            return null;
        }

        static async fetchAsset(url, asset) {
            if(Array.isArray(url)) {
                for(let u of url) {
                    try {
                        let fetchedAsset = await WPMv2.fetchAsset(u, asset);
                        if(fetchedAsset != null) {
                            return fetchedAsset;
                        }
                    } catch(e) {
                        //Ignore
                    }
                }
            }

            let assetUrl = url.substring(0, url.indexOf("?"));
            if (!assetUrl.endsWith("/")) {
                assetUrl += "/";
            }

            assetUrl += asset;

            let response = await fetch(assetUrl, {credentials: 'same-origin'});
            let blob = await response.blob();

            return blob;
        }

        static async fetchAssets(url) {
            if(Array.isArray(url)) {
                for(let u of url) {
                    try {
                        let assets = await WPMv2.fetchAssets(u);
                        if (assets != null) {
                            return assets;
                        }
                    } catch(e) {
                        //Ignore ?
                    }
                }
            }

            if(!url.endsWith("?assets&latest")) {
                url = url.substring(0, url.indexOf("?")) + "?assets&latest";
            }

            if (WPMv2.assetsCache[url] != null) {
                if (Date.now() - WPMv2.assetsCache[url].timestamp < WPMv2.cacheTimeout) {
                    return WPMv2.assetsCache[url].assets;
                }
            }

            let response = await fetch(url, {credentials: 'same-origin'});

            let assetsJson = await response.json();

            let assetResult = new Map();

            assetsJson.forEach((asset)=>{
                let current = assetResult.get(asset.fileName);

                if(current == null || current.v < asset.v) {
                    assetResult.set(asset.fileName, asset);
                }
            });

            WPMv2.assetsCache[url] = {
                assets: assetResult,
                timestamp: Date.now()
            };

            return assetResult;
        }

        static lookupRepoAlias(alias) {
            let localStorageAliases = {};
            let sessionStorageAliases = {};
            try {
                localStorageAliases = JSON.parse(localStorage.getItem(WPM_ALIASES));
            } catch (ex){
                console.warn("Unparseable localStorage.repositoryAliases", ex);
            }
            try {
                sessionStorageAliases = JSON.parse(sessionStorage.getItem(WPM_ALIASES));
            } catch (ex){
                console.warn("Unparseable sessionStorage.repositoryAliases", ex);
            }

            if(localStorageAliases?.hasOwnProperty(alias)) {
                let result = localStorageAliases[alias];
                return result;
            } else if(sessionStorageAliases?.hasOwnProperty(alias)) {
                let result = sessionStorageAliases[alias];
                return result;
            } else {
                //Check if alias might be an url already?
                if(alias.startsWith("http") || alias.startsWith("/")) {
                    //Probabely an url
                    return alias;
                }
            }

            return ["/"+alias+"/?raw", "/"+alias+"/index.html"];
        }

        static async fetchDom(url) {
            //Lookup repos aliases
            url = WPMv2.lookupRepoAlias(url);

            if(Array.isArray(url)) {
                //Call again for each url in array
                for(let u of url) {
                    try {
                        let fetchedDom = await this.fetchDom(u);
                        if(fetchedDom != null) {
                            return fetchedDom;
                        }
                    } catch(e) {
                        //Ignore?
                        console.warn(e);
                    }
                }
            } else {
                if(url.endsWith("?raw") && !url.endsWith("/?raw")) {
                    url = url.substring(0, url.lastIndexOf("?raw")) + "/?raw";
                }
                
                // Check the cache for ongoing fetches for this URL
                let cachedDom = WPMv2.domCache.get(url);
                if (cachedDom != null) {
                    cachedDom = await cachedDom;
                    if (Date.now() - cachedDom.timestamp < WPMv2.cacheTimeout) {
                        return cachedDom.dom;
                    }
                }

                // No ongoing fetches, start one
                let fetcherPromise = (async function fetchDOMPromise(){
                    let response = await fetch(url, {credentials: 'same-origin'});
                    if(response != null) {
                        let documentText = await response.text();

                        let parsedDom = WPMv2.parser.parseFromString(documentText, "text/html");
                        if (parsedDom.readyState === "loading") {
                            await new Promise((resolve, reject) => {
                                parsedDom.addEventListener("DOMContentLoaded", () => {
                                    resolve();
                                });
                            });
                        }

                        return {
                            dom: parsedDom,
                            timestamp: Date.now()
                        };
                    }
                })();
                WPMv2.domCache.set(url, fetcherPromise);
                
                return (await fetcherPromise).dom;
            }

            console.error("Unable to fetchDOM from: ", url);
            return null;
        }

        /**
         * Strips all Webstrate protection from the given dom element and its children.
         *
         * @example
         * WPMv2.stripProtection(document.querySelector("#myElement"));
         *
         * @param {HTMLElement} html - The element to strip protection from
         */
        static stripProtection(html) {
            function stripAttributeProtection(elm) {
                if (!elm.__approvedAttributes) {
                    try {
                        elm.__approvedAttributes = new Set();
                    } catch (e) {
                    }
                }

                if (elm.attributes != null) {
                    for (let i = 0, atts = elm.attributes, n = atts.length; i < n; i++) {
                        elm.__approvedAttributes.add(atts[i].nodeName);
                    }
                }
            }

            if (html instanceof Array) {
                html.forEach((entry) => {
                    if (entry != null) {
                        WPMv2.stripProtection(entry);
                    }
                });
                return;
            }

            if (!html.__approved) {
                try {
                    html.__approved = true;
                } catch (e) {
                }
            }

            if (html.removeAttribute != null) {
                html.removeAttribute("unapproved");
            }

            stripAttributeProtection(html);

            if (html.childNodes != null) {
                Array.from(html.childNodes).forEach((child) => {
                    WPMv2.stripProtection(child);
                });
            } else if (html.children != null) {
                Array.from(html.children).forEach((child) => {
                    WPMv2.stripProtection(child);
                });
            }

            if (html.content != null) {
                WPMv2.stripProtection(html.content);
            }
        }

        /**
         * Updates the version of WPMv2 in the current page, with the version in the given url
         *
         * @example
         * await WPMv2.updateWPM("https://some.site.com/containsLatestWPMv2");
         * //WPMv2 is now updated
         *
         * @param {string} url - URL to the webstrate to update WPMv2 from
         * @returns {Promise<void>} - Resolves when WPMv2 is updated
         */
        static async updateWPM(url) {
            console.group("Updating WPM...");
            if(url == null) {
                console.log("No repository given for update, defaulting to \"/wpm/?raw\"");
                url = "/wpm/?raw";
            }

            console.log("Version before update:", window.WPMv2.version);

            let dom = await WPMv2.fetchDom(url);

            let newWpm = dom.querySelector("#WPMv2-script");

            let ourWpm = document.querySelector("#WPMv2-script");

            ourWpm.textContent = newWpm.textContent;

            if(ourWpm.hasAttribute("src")) {
                ourWpm.removeAttribute("src");
                console.warn("Removed src attribute on WPMScript, now inlined instead!");
            }
            eval.call(null, ourWpm.textContent);
            console.log("Version after update:", window.WPMv2.version);
            console.groupEnd();
        }

        /**
         * Installs WPMv2 into the given webstrate. Can be given as an iframe that already points to a transcluded webstrate, or the url to a webstrate.
         *
         * @example
         * await WPMv2.installWPMInto("https://some.site.com/myWebstrate");
         * //WPMv2 is now installed
         *
         * @param {HTMLIFrameElement|string} iframeOrUrl - The iframe or url that WPMv2 should be installed into
         * @returns {Promise<void>} - Resolves when WPMv2 is done installing.
         */
        static async installWPMInto(iframeOrUrl) {
            let iframe = null;
            let transient = null;

            if (typeof iframeOrUrl === "string") {
                iframe = document.createElement("iframe");
                iframe.src = iframeOrUrl;
                let promise = new Promise((resolve, reject) => {
                    iframe.webstrate.on("transcluded", function once() {
                        iframe.webstrate.off("transcluded", once);
                        resolve();
                    });
                });

                transient = document.createElement("transient");
                transient.append(iframe);
                document.body.append(transient);

                await promise;
            } else {
                //Attempt to unpack cQuery/jQuery objects
                if (iframeOrUrl[0] != null) {
                    iframeOrUrl = iframeOrUrl[0];
                }

                if (iframeOrUrl instanceof HTMLIFrameElement) {
                    iframe = iframeOrUrl;
                } else {
                    console.log("Unknown iframe/url: ", iframeOrUrl);
                    return;
                }
            }

            let targetHead = iframe.contentDocument.head;

            //Remove old WPMv2 if present
            let oldWpm = iframe.contentDocument.querySelector("#WPMv2-script");
            if (oldWpm != null) {
                oldWpm.parentNode.removeChild(oldWpm);
            }

            let clonedScript = document.querySelector("#WPMv2-script").cloneNode(true);

            if (clonedScript.src != null && clonedScript.src.length > 0) {
                let response = await fetch(clonedScript.src, {credentials: 'same-origin'});
                let scriptContent = await response.text();

                clonedScript.removeAttribute("src");
                clonedScript.textContent = scriptContent;
            }

            WPMv2.stripProtection(clonedScript);
            targetHead.insertBefore(clonedScript, targetHead.firstChild);

            iframe.contentWindow.eval.call(null, clonedScript.textContent);

            await iframe.contentWindow.webstrate.dataSaved();

            if (transient != null) {
                document.body.removeChild(transient);
            }
        }

        static notifyRemove(packageName, packageDom) {
            let event = new CustomEvent("wpm.packageRemoved", {detail: packageName});
            packageDom.dispatchEvent(event);

            let eventAny = new CustomEvent("wpm.packageRemovedAny", {detail: packageName});
            document.dispatchEvent(eventAny);
        }

        static getRegisteredRepositories(useLocalStorage) {
            let currentAliases = null;

            try {
                if(useLocalStorage) {
                    currentAliases = JSON.parse(localStorage.getItem(WPM_ALIASES));
                } else {
                    currentAliases = JSON.parse(sessionStorage.getItem(WPM_ALIASES));
                }
            } catch (ex){}
            if (currentAliases == null || typeof currentAliases !== "object"){
                currentAliases = {};
            }

            return currentAliases;
        }

        /**
         * Registers a repository alias
         * @param alias The alias to register
         * @param repository The repository to register the alias to
         * @param useLocalStorage If true, the registered alias is registered in localStorage, if not, in sessionStorage
         */
        static registerRepository(alias, repository, useLocalStorage = false) {
            let currentAliases = null;

            try {
                if(useLocalStorage) {
                    currentAliases = JSON.parse(localStorage.getItem(WPM_ALIASES));
                } else {
                    currentAliases = JSON.parse(sessionStorage.getItem(WPM_ALIASES));
                }
            } catch (ex){}
            if (currentAliases == null || typeof currentAliases !== "object"){
                currentAliases = {};
            }

            currentAliases[alias] = repository;

            if(useLocalStorage) {
                localStorage.setItem(WPM_ALIASES, JSON.stringify(currentAliases));
            } else {
                sessionStorage.setItem(WPM_ALIASES, JSON.stringify(currentAliases));
            }
        }

        /**
         * Unregisters a repository alias
         * @param alias The alias to unregister
         * @param useLocalStorage If true, the alias is removed from localStorage, if not, from sessionStorage
         */
        static unregisterRepository(alias, useLocalStorage = false) {
            let currentAliases = null;

            try {
                if(useLocalStorage) {
                    currentAliases = JSON.parse(localStorage.getItem(WPM_ALIASES));
                } else {
                    currentAliases = JSON.parse(sessionStorage.getItem(WPM_ALIASES));
                }
            } catch (ex){
                console.error(ex);
            }
            if (currentAliases == null || typeof currentAliases !== "object"){
                console.log(currentAliases);
                currentAliases = {};
            }

            delete currentAliases[alias];

            if(useLocalStorage) {
                localStorage.setItem(WPM_ALIASES, JSON.stringify(currentAliases));
            } else {
                sessionStorage.setItem(WPM_ALIASES, JSON.stringify(currentAliases));
            }
        }

        /**
         * Clears all registered aliases from storage
         * @param useLocalStorage If true, clears from localStorage, if not, from sessionStorage
         */
        static clearRegisteredRepositories(useLocalStorage = false) {
            if(useLocalStorage) {
                localStorage.setItem(WPM_ALIASES, "{}");
            } else {
                sessionStorage.setItem(WPM_ALIASES, "{}");
            }
        }
    }

    WPMv2.domCache = new Map();
    WPMv2.assetsCache = {};
    WPMv2.parser = new DOMParser();
    WPMv2.cacheTimeout = 5000;

    /**
     * A WPM package
     * @memberof WPMv2
     */
    class WPMPackage {
        /**
         * Create a new WPMPackage
         * @param {string} name - The package name
         * @param {string} repository - The repository that the package should be fetched from
         * @param {json} [descriptorJson] - Package Descriptor
         */
        constructor(name, repository, descriptorJson = {}) {
            /**
             * The name of the package
             * @type {string}
             */
            this.name = name;
            /**
             * The repository the package is fetched from
             * @type {string}
             */
            this.repository = repository;

            /**
             * The version of the package
             * @type {number}
             */
            this.version = -1;
            /**
             * Package dependencies that will be installed when the package is installed
             * @type {string[]}
             */
            this.dependencies = [];
            /**
             * Optional Package dependencies
             * @type {string[]}
             */
            this.optionalDependencies = [];
            /**
             * Assets that the package uses, will be copied over to the webstrate where the package is installed
             * @type {Array.<string>}
             */
            this.assets = [];
            /**
             * A description of the package
             * @type {string}
             */
            this.description = "";
            /**
             * A human friendly name for the package
             * @type {string}
             */
            this.friendlyName = "";
            /**
             * Changelog, holding any changelog information for the package
             * @type {object}
             */
            this.changelog = {};
            /**
             * Link to documentation of the package if any exists
             * @type {string}
             */
            this.documentationLink = "";

            this.dependencyMap = new Map();
            this.optionalDependencyMap = new Map();

            this.appendMethod = "append";
            this.appendTarget = null;

            this.bootstrap = true;

            this.updateFromJson(descriptorJson);
        }

        updateFromOptions(options) {
            ["appendMethod", "appendTarget", "repository", "bootstrap"].forEach((optionProperty)=>{
                if(options.hasOwnProperty(optionProperty)) {
                    this[optionProperty] = options[optionProperty];
                }
            })
        }

        getPackageOptions() {
            let options = {};

            ["appendMethod", "appendTarget", "repository", "bootstrap"].forEach((optionProperty)=>{
                options[optionProperty] = this[optionProperty];
            });

            return options;
        }

        updateFromJson(packageJson) {
            let self = this;

            this.descriptor = packageJson;
            
            ["version", "friendlyName", "dependencies", "optionalDependencies", "description", "changelog", "documentationLink", "license"].forEach((packageProperty)=>{
                if (packageJson.hasOwnProperty(packageProperty)){
                    this[packageProperty] = packageJson[packageProperty];
                }
            });

            if (packageJson.hasOwnProperty("assets")) {
                packageJson.assets.forEach((asset) => {
                    if (asset.src != null) {
                        self.assets.push(asset.src);
                    } else {
                        self.assets.push(asset);
                    }
                });
            }

            this.dependencies.forEach((dep) => {
                let split = dep.split(" ");

                let repo = null;
                let packageName = null;

                if (split.length === 1) {
                    packageName = split[0].replace("#", "");
                    repo = this.repository;
                } else {
                    packageName = split[1].replace("#", "");
                    repo = split[0];
                }

                self.dependencyMap.set(packageName, repo);
            });

            this.optionalDependencies.forEach((dep) => {
                let split = dep.split(" ");

                let repo = null;
                let packageName = null;

                if (split.length === 1) {
                    packageName = split[0].replace("#", "");
                    repo = this.repository;
                } else {
                    packageName = split[1].replace("#", "");
                    repo = split[0];
                }

                self.optionalDependencyMap.set(packageName, repo);
            });
        }

        toString() {
            return this.name + "[" + this.version + "]";
        }
    }

    let removedObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.removedNodes.forEach((node) => {
                if (node.matches != null && node.matches(".packages .package, wpm-package")) {
                    WPMv2.notifyRemove(node.id, node);
                } else if (node.querySelectorAll != null) {
                    node.querySelectorAll(".packages .package, wpm-package").forEach((child) => {
                        WPMv2.notifyRemove(child.id, child);
                    });
                }
            });
        });
    });

    removedObserver.observe(document, {
        childList: true,
        attributes: false,
        subtree: true
    });

    //Setup attribute "transient-element" that marks a DOM element as transient
    if(typeof webstrate !== "undefined") {
        let oldIsTransientElement = webstrate.config.isTransientElement;
        webstrate.config.isTransientElement = (node) => {
            if (node.hasAttribute("transient-element")) {
                return true;
            }

            return oldIsTransientElement(node);
        };
    }

    //WPMv2 Interface to the world!
    window.WPMv2 = {
        require: WPMv2.require,
        requireAll: WPMv2.requireAll,
        installWPMInto: WPMv2.installWPMInto,
        stripProtection: WPMv2.stripProtection,
        updateWPM: WPMv2.updateWPM,
        getPackagesFromRepository: WPMv2.getPackagesFromRepository,
        getCurrentlyInstalledPackages: WPMv2.getCurrentlyInstalledPackages,
        getLatestPackageFromPackage: WPMv2.getLatestPackageFromPackage,
        registerRepository: WPMv2.registerRepository,
        unregisterRepository: WPMv2.unregisterRepository,
        clearRegisteredRepositories: WPMv2.clearRegisteredRepositories,
        getRegisteredRepositories: WPMv2.getRegisteredRepositories,
        getLocalRepositoryURL: WPMv2.getLocalRepositoryURL,
        version: 2.42,
        revision: "$Id: WPMv2.js 1023 2023-03-14 10:02:57Z au182811@uni.au.dk $",
        test: WPMv2
    };
    
    window.WPM = window.WPMv2;
    window.WPMPackage = WPMPackage;
})(window);

// Provide bootloader functionality
class WPMBoot {
    static loadedCallbacks = [];
    static isLoaded = false;
    
    static async wpmv2_bootloader(){
        document.querySelector("html").setAttribute("transient-wpm2-bootloader", "loading");
        
        let bootConfigElement = document.querySelector("head script[type='text/json+bootconfig']");
        if (!bootConfigElement){
            return;
        }

        let bootConfig = null;
        try {
            bootConfig = JSON.parse(bootConfigElement.textContent);
        } catch (ex){
            console.error("WPM bootloader cannot parse boot config", bootConfigElement.textContent, ex);
            return;
        }

        if (!bootConfig.require){
            console.warn("WPM bootloader did not find required 'require' section in boot config, ignoring");
            return;
        }

        if (!Array.isArray(bootConfig.require)){
            console.warn("WPM bootloader 'require' section in boot config is not an array, ignoring");
            return;
        }

        // Load all required packages with WPM
        for (let requireStep of bootConfig.require){
            if (!(requireStep.dependencies && Array.isArray(requireStep.dependencies))){
                console.warn("WPM bootloader skipping incorrect requirestep, dependency list is missing", requireStep);
                continue;
            }
            if (requireStep.repositories){
                if (typeof requireStep.repositories !== "object"){
                    console.warn("WPM bootloader skipping registration of repositories because requireStep.repositories isn't an object map of name->url", requireStep);
                } else {
                    for (const [key, value] of Object.entries(requireStep.repositories)) {
                        WPMv2.registerRepository(key, value);
                    }
                }
            }

            if (requireStep.options){
                await WPMv2.require(requireStep.dependencies, requireStep.options);
            } else {
                await WPMv2.require(requireStep.dependencies);
            }
        }
               
        // Fire loaded events
        document.querySelector("html").setAttribute("transient-wpm2-bootloader", "initializing");
        while (WPMBoot.loadedCallbacks.length>0){
            let callback = WPMBoot.loadedCallbacks.pop();
            try {
                await callback();
            } catch (ex){
                console.error("WPMv2 Bootloader exception in WPMBoot.onLoaded(...) callback", ex, callback);
            }
        }
        document.querySelector("html").setAttribute("transient-wpm2-bootloader", "loaded");
    }
    
    static async onLoaded(callback){
        if (WPMBoot.isLoaded){
            await callback();
        } else {
            WPMBoot.loadedCallbacks.push(callback);
        }
    }
}
window.WPMBoot = WPMBoot;

document.querySelector("html").setAttribute("transient-wpm2-bootloader", "waiting");
if(typeof webstrate  !== "undefined") {
    // Webstrate mode
    webstrate.on("loaded", async function wpmv2_bootloader_loader() {
        await WPMBoot.wpmv2_bootloader();
    });
} else {
    // Standalone mode
    document.addEventListener("DOMContentLoaded", async function(event) {
        await WPMBoot.wpmv2_bootloader();
    });
}
