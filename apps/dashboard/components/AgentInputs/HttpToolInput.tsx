import DeleteIcon from '@mui/icons-material/Delete';
import InfoRoundedIcon from '@mui/icons-material/InfoRounded';
import SettingsIcon from '@mui/icons-material/Settings';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Button,
  Card,
  Checkbox,
  Divider,
  FormControl,
  FormHelperText,
  FormLabel,
  IconButton,
  Option,
  Select,
  Sheet,
  Stack,
  Typography,
} from '@mui/joy';
import React, {
  ElementRef,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Control,
  FieldValue,
  FieldValues,
  FormProvider,
  useFieldArray,
  useForm,
  useFormContext,
} from 'react-hook-form';

import { useDebounce } from '@app/hooks/useDebounce';
import useDeepCompareEffect from '@app/hooks/useDeepCompareEffect';
import useModal from '@app/hooks/useModal';

import {
  CreateAgentSchema,
  HttpToolSchema,
  ToolSchema,
} from '@chaindesk/lib/types/dtos';

import { Choices } from '../BlablaFormEditor/FieldsInput';
import Input from '../Input';

type Origin = 'url' | 'fields';
export type Fields =
  | {
      key: string;
      value?: string | undefined;
      isUserProvided?: boolean | undefined;
      description?: string;
      acceptedValues?: (string | undefined)[];
    }[]
  | undefined;

const KeyValueFieldArray = ({
  name,
  label,
  userOnly = false,
  prefix,
}: {
  name:
    | 'config.queryParameters'
    | 'config.pathVariables'
    | 'config.body'
    | 'config.headers'
    | 'tools.0.config.queryParameters'
    | 'tools.0.config.pathVariables'
    | 'tools.0.config.body'
    | 'tools.0.config.headers';
  label?: string;
  userOnly?: boolean;
  prefix: '' | 'tools.0.';
}) => {
  const methods = useFormContext<HttpToolSchema | CreateAgentSchema>();

  const parameters = useFieldArray({
    control: methods.control as Control<HttpToolSchema>,
    name,
  });

  // the source of change.
  const syncOriginRef = useRef<Origin>('url');

  // TODO: fix types issue#53588777
  const watchedValues = methods.watch([
    `${prefix}config.url`,
    `${prefix}config.queryParameters`,
    `${prefix}config.pathVariables`,
  ] as any);

  const debouncedWatchedValues = useDebounce(watchedValues, 50);

  /* synchronize state of url with state of query fields */
  const syncQueryParamsToUrl = (
    origin: Origin,
    url: string,
    fields: Fields
  ) => {
    switch (origin) {
      case 'url':
        try {
          let searchParams = new Map(new URL(url).searchParams.entries());

          // No search params, remove all at once, exit early.
          if (searchParams.size === 0) {
            parameters.remove();
            return;
          }

          if (fields?.length !== searchParams.size) {
            fields?.forEach((field, index) => {
              if (!searchParams.has(field.key)) {
                parameters.remove(index);
              }
            });
          }

          searchParams.forEach((value, key) => {
            const fieldIndex = fields?.findIndex((field) => field.key === key);

            const payload = {
              key,
              ...(value == '{user}'
                ? {
                    value: '',
                    isUserProvided: true,
                  }
                : { value, isUserProvided: false }),
            };

            if (fieldIndex === undefined || fieldIndex == -1) {
              const indexInUrl = Array.from(searchParams.keys()).indexOf(key);
              // should not update nested content.
              const queryParamContent = methods.getValues(
                `${prefix}config.queryParameters.${indexInUrl}`
              );
              parameters.update(indexInUrl, {
                ...queryParamContent,
                ...payload,
              });
            } else if (value !== fields?.[fieldIndex!].value) {
              // should not update nested content.
              const queryParamContent = methods.getValues(
                `${prefix}config.queryParameters.${fieldIndex}`
              );

              parameters.update(fieldIndex, {
                ...queryParamContent,
                ...payload,
              });
            }
          });
        } catch (e) {
          if (url === '') {
            parameters.remove();
          }
        }
        break;
      case 'fields':
        try {
          const Url = new URL(url);
          Url.search = '';
          fields?.forEach((field) => {
            if (!(field.value == '' && !field.isUserProvided)) {
              Url.searchParams.set(
                field.key,
                field.isUserProvided ? '{user}' : field.value || ''
              );
            }
          });
          methods.setValue(`${prefix}config.url`, decodeURI(Url.toString()), {
            shouldValidate: true,
            shouldDirty: true,
          });
        } catch (e) {
          let newUrl = '';
          fields?.forEach((field, index) => {
            // should not add query param if no value.
            if (field.value == '' && !field.isUserProvided) return;

            newUrl += `${index === 0 ? '?' : '&'}${field.key}=${
              field.isUserProvided ? '{user}' : field.value
            }`;
          });

          // let's not cause a re-render if no change.
          if (newUrl !== url) {
            methods.setValue(`${prefix}config.url`, newUrl, {
              shouldValidate: true,
              shouldDirty: true,
            });
          }
        }
        break;
      default:
        throw new Error(`Uknown Origin: ${syncOriginRef.current}`);
    }
  };

  const syncPathVariablesToUrl = (
    origin: Origin,
    url: string,
    fields: Fields
  ) => {
    switch (origin) {
      case 'url':
        const pathVariablesFromUrl =
          url
            ?.split('?')[0]
            ?.match(/:([\w-]+)/g)
            ?.map((param) => param.substring(1)) || [];

        // clear route params fields. exit.
        if (pathVariablesFromUrl.length == 0) {
          parameters.remove();
          return;
        }

        fields?.forEach((field, index) => {
          if (
            !pathVariablesFromUrl.includes(field.key) &&
            pathVariablesFromUrl.length !== parameters.fields.length
          ) {
            parameters.remove(index);
          }
        });

        pathVariablesFromUrl.forEach((param, index) => {
          // should not update nested content.
          const pathVariableContent = methods.getValues(
            `${prefix}config.pathVariables.${index}`
          );

          parameters.update(index, {
            ...pathVariableContent,
            key: param,
            isUserProvided: true,
          });
        });
        break;
      case 'fields':
        try {
          const Url = new URL(url);
          Url.pathname = Url.pathname.replace(/\/+$/, '');
          let basePath =
            Url.origin +
            Url.pathname
              .split('/')
              .filter((p) => !p.startsWith(':'))
              .join('/');

          if (fields?.length == 0) {
            methods.setValue(
              `${prefix}config.url`,
              `${basePath}${Url.search}`,
              {
                shouldValidate: false,
                shouldDirty: false,
              }
            );
          }
          const queryPaths = fields
            ?.map((field) => field.key)
            .filter((key) => key !== '');

          queryPaths?.forEach((path) => (basePath += `/:${path}`));

          if (basePath !== url) {
            methods.setValue(
              `${prefix}config.url`,
              `${basePath}${Url.search}`,
              {
                shouldValidate: false,
                shouldDirty: false,
              }
            );
          }
        } catch (e) {
          if (fields) {
            const pathVariables = fields
              .map((field) => `/:${field.key}`)
              .join('');
            methods.setValue(`${prefix}config.url`, pathVariables, {
              shouldValidate: false,
              shouldDirty: false,
            });
          }
        }
        break;
      default:
        throw new Error(`Uknown Origin: ${syncOriginRef.current}`);
    }
  };

  // synchronize state of url field with state query and paths array fields.
  useDeepCompareEffect(() => {
    const [debouncedUrl, debouncedParamFields, debouncedPathVariablesFields] =
      debouncedWatchedValues;

    if (name.includes('queryParameters')) {
      syncQueryParamsToUrl(
        syncOriginRef.current,
        debouncedUrl,
        debouncedParamFields
      );
    } else if (name.includes('pathVariables')) {
      syncPathVariablesToUrl(
        syncOriginRef.current,
        debouncedUrl,
        debouncedPathVariablesFields
      );
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedWatchedValues, syncOriginRef.current]);

  return (
    <FormControl
      onMouseDown={() => {
        syncOriginRef.current = 'fields';
      }}
      onMouseLeave={() => {
        syncOriginRef.current = 'url';
      }}
    >
      {label && <FormLabel>{label}</FormLabel>}
      <Stack gap={1}>
        {parameters.fields.map((field, index) => (
          <Stack key={field.id} gap={1}>
            <Stack direction="row" gap={1} alignItems={'end'}>
              <Input
                control={methods.control}
                placeholder="Key"
                {...methods.register(`${name}.${index}.key` as any)}
              />

              <Input
                control={methods.control}
                placeholder="Value"
                {...methods.register(`${name}.${index}.value` as any)}
                disabled={!!field.isUserProvided}
              />
              <FormControl>
                <Card variant="outlined" size="sm">
                  <Checkbox
                    size="sm"
                    label="Provided By User"
                    checked={!!field.isUserProvided}
                    slotProps={{
                      label: {
                        sx: {
                          whiteSpace: 'nowrap',
                        },
                      },
                    }}
                    onChange={(e) => {
                      const fieldValues = methods.getValues(`${name}.${index}`);
                      parameters.update(index, {
                        ...fieldValues,
                        value: '',
                        isUserProvided: e.target.checked,
                      });
                    }}
                  />
                </Card>
              </FormControl>

              <IconButton
                variant="outlined"
                color="neutral"
                onClick={() => parameters.remove(index)}
              >
                <DeleteIcon />
              </IconButton>
            </Stack>
            {field.isUserProvided && (
              <Accordion sx={{ ml: 1 }}>
                <AccordionSummary>
                  <Typography
                    level="body-sm"
                    color="primary"
                    startDecorator={
                      <SettingsIcon fontSize="sm" color="primary" />
                    }
                  >
                    Advanced
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Stack gap={2}>
                    <Divider />
                    <Input
                      control={methods.control}
                      label="Describe your key usage for better AI inference :"
                      placeholder="Description"
                      {...methods.register(
                        `${name}.${index}.description` as any
                      )}
                    />

                    <Choices<HttpToolSchema | CreateAgentSchema>
                      actionLabel="Add A Value"
                      name={`${name}.${index}.acceptedValues`}
                      init={false}
                      label="Specify the accepted values for the key :"
                    />
                    <Divider sx={{ my: 2 }} />
                  </Stack>
                </AccordionDetails>
              </Accordion>
            )}
          </Stack>
        ))}
        <Button
          variant="outlined"
          color="neutral"
          onClick={() =>
            parameters.append({
              key: '',
              value: '',
              ...(userOnly ? { isUserProvided: userOnly } : {}),
            })
          }
        >
          + Add
        </Button>
      </Stack>
    </FormControl>
  );
};

type Props = {
  name?: 'tools.0';
};

function HttpToolInput({ name }: Props) {
  const methods = useFormContext<HttpToolSchema | CreateAgentSchema>();
  const prefix: 'tools.0.' | '' = name ? `${name}.` : '';
  const templatesModal = useModal();
  const [withApprovalChecked] = methods.watch([`${prefix}config.withApproval`]);
  const [methodValue] = methods.watch([`${prefix}config.method`]);

  // Fallback request method to GET.
  useEffect(() => {
    const requestMethod = methods.getValues(`${prefix}config.method`);
    if (!requestMethod) {
      methods.setValue(`${prefix}config.method`, 'GET', {
        shouldValidate: true,
        shouldDirty: true,
      });
    }
  }, [methods, prefix]);

  return (
    <Stack>
      <Stack
        direction="row"
        sx={{
          mt: -3,
          mb: -2,
        }}
      >
        <Button
          variant="outlined"
          onClick={templatesModal.open}
          sx={{ mx: 'auto' }}
          size="sm"
        >
          Start from a template
        </Button>
      </Stack>

      <Stack gap={2}>
        <Input
          control={methods.control}
          label={'Name'}
          {...methods.register(`${prefix}config.name`)}
        />

        <Input
          control={methods.control}
          label={'Description'}
          {...methods.register(`${prefix}config.description`)}
          placeholder="e.g: Useful for getting the current weather in a given city."
        />
        <Alert color="warning" startDecorator={<InfoRoundedIcon />}>
          <Stack>
            <p>
              The description is very important, this is what the Agent will use
              to decide when to use it and what to do.
            </p>
            <p>{`For instance for tool that retrieves the current weather of a given city: "Useful for getting the current weather in a given city." is better than "Weather API"`}</p>
          </Stack>
        </Alert>

        <Input
          control={methods.control}
          label={'URL to call'}
          {...methods.register(`${prefix}config.url`)}
        />

        <FormControl>
          <FormLabel>Request Method</FormLabel>

          <Select
            defaultValue={'GET'}
            value={methodValue}
            onChange={(_, value) => {
              if (value) {
                methods.setValue(
                  `${prefix}config.method`,
                  value as HttpToolSchema['config']['method'],
                  {
                    shouldValidate: true,
                    shouldDirty: true,
                  }
                );
              }
            }}
          >
            <Option value="GET">GET</Option>
            <Option value="POST">POST</Option>
            <Option value="PUT">PUT</Option>
            <Option value="PATCH">PATCH</Option>
            <Option value="DELETE">DELETE</Option>
          </Select>
        </FormControl>

        <KeyValueFieldArray
          label="Path Variables"
          prefix={prefix}
          name={`${prefix}config.pathVariables`}
          userOnly
        />

        <KeyValueFieldArray
          label="Headers"
          prefix={prefix}
          name={`${prefix}config.headers`}
        />

        <KeyValueFieldArray
          label="Query Parameters"
          prefix={prefix}
          name={`${prefix}config.queryParameters`}
        />

        {!['GET', 'DELETE'].includes(
          methods.getValues(`${prefix}config.method`)
        ) && (
          <KeyValueFieldArray
            label="Body Parameters"
            prefix={prefix}
            name={`${prefix}config.body`}
          />
        )}

        {/* <Card size="sm" variant="outlined"> */}
        <FormControl>
          <Checkbox
            label="Approval Required"
            checked={!!withApprovalChecked}
            onChange={(e) => {
              methods.setValue(
                `${prefix}config.withApproval`,
                e.target.checked,
                {
                  shouldDirty: true,
                  shouldValidate: true,
                }
              );
            }}
          />
          <FormHelperText>
            {`When enabled, an administrator's approval is required to proceed with the action`}
          </FormHelperText>
        </FormControl>
        {/* </Card> */}

        <templatesModal.component
          dialogProps={{
            sx: {
              maxWidth: 'sm',
              height: 'auto',
            },
          }}
        >
          <Card>
            <Stack gap={2} direction="row">
              <Stack>
                <Typography level="body-md">Random Cat Picture</Typography>
                <Typography level="body-sm">
                  Ask your agent to fetch a random cat picture from
                  thecatapi.com
                </Typography>
              </Stack>
              <Button
                size="sm"
                sx={{ ml: 'auto', alignSelf: 'center' }}
                onClick={() => {
                  methods.setValue(
                    `${prefix}config`,
                    {
                      name: 'Random Cat Image',
                      description: 'Useful for getting a random cat image',
                      url: 'https://api.thecatapi.com/v1/images/search',
                      method: 'GET',
                      headers: [],
                      queryParameters: [],
                      body: [],
                    },
                    {
                      shouldDirty: true,
                      shouldValidate: true,
                    }
                  );

                  templatesModal.close();
                }}
              >
                Select
              </Button>
            </Stack>
          </Card>
        </templatesModal.component>
      </Stack>
    </Stack>
  );
}

export default memo(HttpToolInput);
