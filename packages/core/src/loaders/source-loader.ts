import { GraphQLSchema } from "graphql";
import { stitchSchemas } from "@graphql-tools/stitch";
import {
  MergerPlugin,
  PluginConfig,
  TransformPlugin,
  HandlerPlugin,
  PluginAction,
  SourceConfig,
  MergerSourceConfig,
  HandlerSourceConfig,
  PluginLoader,
} from "../types";

export async function loadSource(config: SourceConfig, pluginLoader: PluginLoader): Promise<GraphQLSchema> {
  const schema = isHandlerSourceConfig(config)
    ? await loadHandler(config, pluginLoader)
    : await loadMerger(config, pluginLoader);
  return applyTransforms(schema, config, pluginLoader);
}

const defaultMerger: MergerPlugin = (options) =>
  stitchSchemas({
    subschemas: options.sources.map((source) => source.schema),
  });

async function loadHandler(config: HandlerSourceConfig, pluginLoader: PluginLoader) {
  const [handler, handlerConfig] = await getPluginFromConfig(config.handler, pluginLoader);
  return (handler as HandlerPlugin)({
    action: PluginAction.Handle,
    sourceName: config.name,
    config: handlerConfig,
    loader: pluginLoader,
  });
}

async function loadMerger(config: MergerSourceConfig, pluginLoader: PluginLoader) {
  const [merger, mergerConfig] = config.merger
    ? await getPluginFromConfig(config.merger, pluginLoader)
    : [defaultMerger, null];
  return (merger as MergerPlugin)({
    action: PluginAction.Merge,
    config: mergerConfig,
    loader: pluginLoader,
    sources: await Promise.all(
      config.sources.map(async (sourceConfig) => ({
        name: sourceConfig.name,
        schema: await loadSource(sourceConfig, pluginLoader),
      }))
    ),
  });
}

async function applyTransforms(startingSchema: GraphQLSchema, config: SourceConfig, pluginLoader: PluginLoader) {
  return (config.transforms || []).reduce<Promise<GraphQLSchema>>(
    async (currentSchemaPromise, currentTransformConfig) => {
      const currentSchema = await currentSchemaPromise;
      const [transform, transformConfig] = await getPluginFromConfig(currentTransformConfig, pluginLoader);
      const newSchema = await (transform as TransformPlugin)({
        action: PluginAction.Transform,
        sourceName: config.name,
        schema: currentSchema,
        loader: pluginLoader,
        config: transformConfig,
      });
      return newSchema;
    },
    Promise.resolve(startingSchema)
  );
}

async function getPluginFromConfig(pluginConfig: PluginConfig, pluginLoader: PluginLoader) {
  const pluginName = typeof pluginConfig === "string" ? pluginConfig : Object.keys(pluginConfig)[0];
  const config = typeof pluginConfig === "string" ? null : Object.values(pluginConfig)[0];
  const plugin = await pluginLoader.getPlugin(pluginName);
  return [plugin, config];
}

function isHandlerSourceConfig(config: SourceConfig): config is HandlerSourceConfig {
  return !!(config as HandlerSourceConfig).handler;
}
