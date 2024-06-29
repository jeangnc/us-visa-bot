import { afterEach, afterAll, beforeEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

const server = setupServer()

describe('main', () => {

  beforeEach(vi.resetModules)

  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
  afterEach(() => server.resetHandlers())
  afterAll(() => server.close())

  test('should successfully call API to book time with earliest date/time', () => new Promise(async done => {
    process.argv = ['', '', '2099-01-01']
    vi.stubEnv('LOCALE', 'en-ca')
    vi.stubEnv('EMAIL', 'test@example.com')
    vi.stubEnv('PASSWORD', '123')
    vi.stubEnv('FACILITY_ID', '555')
    vi.stubEnv('SCHEDULE_ID', '222')

    server.use(
      http.get('https://ais.usvisa-info.com/en-ca/niv/users/sign_in', () => {
        return new HttpResponse('<html lang=""><head><title></title><meta name="csrf-token" content="123" /></head></html>', {
          headers: {
            'Set-Cookie': '_yatri_session=123',
            'X-CSRF-TOKEN': '123'
          },
        })
      }),
      http.post('https://ais.usvisa-info.com/en-ca/niv/users/sign_in', () => {
        return new HttpResponse(null, {
          headers: {
            'Set-Cookie': '_yatri_session=123',
            'X-CSRF-TOKEN': '123'
          },
        })
      }),
      http.get('https://ais.usvisa-info.com/en-ca/niv/schedule/222/appointment/days/555.json', () => {
        return HttpResponse.json([{
          date: '2029-01-01',
          business_day: true,
        }, {
          date: '2029-01-02',
          business_day: true,
        }])
      }),
      http.get('https://ais.usvisa-info.com/en-ca/niv/schedule/222/appointment/times/555.json', ({ request }) => {
        return HttpResponse.json({
          business_times: ['08:00', '09:00']
        })
      }),
      http.get('https://ais.usvisa-info.com/en-ca/niv/schedule/222/appointment', () => {
        return new HttpResponse('<html lang=""><head><title></title><meta name="csrf-token" content="123" /></head></html>', {
          headers: {
            'Set-Cookie': '_yatri_session=123',
            'X-CSRF-TOKEN': '123'
          },
        })
      }),
      http.post('https://ais.usvisa-info.com/en-ca/niv/schedule/222/appointment', async ({ request }) => {
        const formData = await request.formData()
        expect(formData.get('appointments[consulate_appointment][facility_id]')).toBe('555')
        expect(formData.get('appointments[consulate_appointment][date]')).toBe('2029-01-01')
        expect(formData.get('appointments[consulate_appointment][time]')).toBe('08:00')
        done()
        return new HttpResponse({})
      })
    )

    await import('./index.js')
  }))
})
