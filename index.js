var _ = require('./lodash'),
    old = require('lodash');

var listing = require('./lib/listing'),
    mapping = require('./lib/mapping'),
    util = require('./lib/util');

var cache = new _.memoize.Cache,
    reHasReturn = /\breturn\b/;

var migrateTemplate = _.template([
  'lodash-migrate: _.<%= name %>(<%= args %>)',
  '  v<%= oldData.version %> => <%= oldData.result %>',
  '  v<%= newData.version %> => <%= newData.result %>',
  ''
].join('\n'));

var renameTemplate = _.template([
  'lodash-migrate: Method renamed',
  '  v<%= oldData.version %> => _.<%= oldData.name %>',
  '  v<%= newData.version %> => _.<%= newData.name %>',
  ''
].join('\n'));

/*----------------------------------------------------------------------------*/

/**
 * Logs `value` if it hasn't been logged before.
 *
 * @private
 * @param {*} value The value to log.
 */
function log(value) {
  if (!cache.has(value)) {
    cache.set(value, true);
    console.log(value);
  }
}

/**
 * Wraps `oldDash` methods to compare results of `oldDash` and `newDash`.
 *
 * @private
 * @param {Function} oldDash The old lodash function.
 * @param {Function} newDash The new lodash function.
 * @returns {Function} Returns `oldDash`.
 */
function wrapLodash(oldDash, newDash) {
  // Wrap static methods.
  _.each(_.functions(oldDash), function(name) {
    oldDash[name] = wrapMethod(oldDash, newDash, name);
  });

  // Wrap `_.prototype` methods that return unwrapped values.
  oldDash.mixin(_.transform(listing.unwrapped, function(source, name) {
    source[name] = oldDash[name];
  }, {}), false);

  // Wrap `_.runInContext.
  oldDash.runInContext = _.wrap(oldDash.runInContext, function(runInContext, context) {
    return wrapLodash(runInContext(context), newDash);
  });

  // Wrap `_#sample` which can return wrapped and unwrapped values.
  oldDash.prototype.sample = _.wrap(oldDash.sample, function(sample, n) {
    var chainAll = this.__chain__,
        result = sample(this.__wrapped__, n);

    if (chainAll || n != null) {
      result = oldDash(result);
      result.__chain__ = chainAll;
    }
    return result;
  });

  // Wrap `_#value` aliases.
  _.each(mapping.realToAlias.value, function(alias) {
    if (oldDash.prototype[alias]) {
      oldDash.prototype[alias] = wrapMethod(oldDash, newDash, alias);
    }
  });

  return oldDash;
}

/**
 * Creates a function that compares results of method `name` on `oldDash`
 * and `newDash` and logs a warning for unequal results.
 *
 * @private
 * @param {Function} oldDash The old lodash function.
 * @param {Function} newDash The new lodash function.
 * @param {string} name The name of the lodash method to wrap.
 * @returns {Function} Returns the new wrapped method.
 */
function wrapMethod(oldDash, newDash, name) {
  var ignoreRename = _.includes(listing.ignored.rename, name),
      ignoreResult = _.includes(listing.ignored.result, name),
      isSeqFunc = _.includes(listing.seqFuncs, name);

  var newName = mapping.rename[name] || name,
      newFunc = isSeqFunc ? newDash.prototype[newName] : newDash[newName],
      oldFunc = isSeqFunc ? oldDash.prototype[name] : oldDash[name];

  return _.wrap(oldFunc, _.rest(function(oldFunc, args) {
    var that = this;

    var data = {
      'name': name,
      'args': util.truncate(
        util.inspect(args)
          .match(/^\[\s*([\s\S]*?)\s*\]$/)[1]
          .replace(/\n */g, ' ')
      ),
      'oldData': {
        'name': name,
        'version': oldDash.VERSION
      },
      'newData': {
        'name': newName,
        'version': newDash.VERSION
      }
    };

    if (!ignoreRename && mapping.rename[name]) {
      log(renameTemplate(data));
    }
    if (ignoreResult) {
      return oldFunc.apply(that, args);
    }
    var argsClone = util.cloneDeep(args);
    if (mapping.iteration[name] &&
        (name != 'times' || !reHasReturn.test(argsClone[1]))) {
      argsClone[1] = _.identity;
    }
    var oldResult = oldFunc.apply(that, args),
        newResult = _.attempt(function() { return newFunc.apply(that, argsClone); });

    if (util.isComparable(oldResult)
          ? !util.isEqual(oldResult, newResult)
          : util.isComparable(newResult)
        ) {
      log(migrateTemplate(_.merge(data, {
        'oldData': { 'result': util.truncate(util.inspect(oldResult)) },
        'newData': { 'result': util.truncate(util.inspect(newResult)) }
      })));
    }
    return oldResult;
  }));
}

/*----------------------------------------------------------------------------*/

module.exports = wrapLodash(old, _);
