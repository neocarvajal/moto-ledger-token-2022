use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token_interface::{self, Burn, Mint, MintTo, TokenAccount, TokenInterface};
use anchor_spl::token_2022::spl_token_2022::extension::{BaseStateWithExtensions, ExtensionType, StateWithExtensions};

declare_id!("64dHKqRTBciEidqLJqCvTWEGWkR1QqyYDZgomMt9AWCj");

#[program]
pub mod registro {
    use super::*;

    pub fn registrar_concesionario(context: Context<RegistrarConcesionario>, 
        nombre_concesionario: String, 
        rif_concesionario: String
    ) -> Result<()> {

        let id_concesionario = context.accounts.registro_global
            .total_concesionarios
            .checked_add(1)
            .ok_or(Errores::ContadorInvalido)?;

        context.accounts.registro_global.total_concesionarios = id_concesionario;

        context.accounts.concesionario.set_inner(Concesionario {
            owner: context.accounts.owner.key(),
            id_concesionario: id_concesionario,
            nombre_concesionario: nombre_concesionario.clone(),
            rif_concesionario: rif_concesionario.clone(),
            total_servicios: 0,
            total_motos: 0,
            total_clientes: 0,
            total_ventas: 0,
            duracion_garantia_dias: 0,
            kilometraje_maximo: 0,
        });

        msg!("========================================");
        msg!("       CONCESIONARIO REGISTRADO");
        msg!("========================================");
        msg!("Nombre: {}", nombre_concesionario);
        msg!("RIF: {}", rif_concesionario);
        msg!("Owner: {}", context.accounts.owner.key());
        msg!("ID: {}", id_concesionario);
        msg!("Estado: Registrado exitosamente");
        msg!("========================================");

        Ok(())
    }

   pub fn configurar_garantia(
        context: Context<ConfigurarGarantia>,
        nombre_concesionario: String,
        duracion_garantia_dias: u16,
        kilometraje_maximo: u64,
    ) -> Result<()> {

        require!(
            duracion_garantia_dias > 0,
            Errores::DuracionGarantiaInvalida
        );

        require!(
            kilometraje_maximo > 0,
            Errores::KilometrajeGarantiaInvalido
        );

        let concesionario = &mut context.accounts.concesionario;

        concesionario.duracion_garantia_dias = duracion_garantia_dias;
        concesionario.kilometraje_maximo = kilometraje_maximo;

        msg!("========================================");
        msg!("       GARANTIA CONFIGURADA");
        msg!("========================================");
        msg!("Concesionario: {}", nombre_concesionario);
        msg!("Owner: {}", context.accounts.owner.key());
        msg!("Duracion: {} dias", duracion_garantia_dias);
        msg!("Kilometraje maximo: {} km", kilometraje_maximo);
        msg!("Estado: Configurada exitosamente");
        msg!("========================================");

        Ok(())
    }

    pub fn registrar_moto(context: Context<RegistrarMoto>, 
        serial: String, 
        placa: String, 
        marca: String, 
        modelo: String, 
        color: String
    ) -> Result<()> {

        require!(
            serial.len() == 17,
            Errores::NivInvalido
        );

        require!(
            placa.len() == 7,
            Errores::PlacaInvalida
        );

        context.accounts.moto.set_inner(Moto {
            serial: serial.clone(),
            placa: placa.clone(),
            marca: marca.clone(),
            modelo: modelo.clone(),
            color: color.clone(),
            garantia: context.accounts.garantia.key(),
            concesionario: context.accounts.concesionario.key(),
            servicios: 0,
            total_reclamaciones: 0,
            vendida: false
        });

        let fecha_inicio = Clock::get()?.unix_timestamp;

        context.accounts.kilometraje_moto.set_inner(KilometrajeMoto {
            moto: context.accounts.moto.key(),
            concesionario: context.accounts.concesionario.key(),
            kilometraje_actual: 0,
            fecha_actualizacion: fecha_inicio,
            bump: context.bumps.kilometraje_moto,
        });

        let duracion_garantia =
            (context.accounts.concesionario.duracion_garantia_dias as i64)
            * 86400;
        
        let fecha_vencimiento = fecha_inicio + duracion_garantia;

        let kilometraje_maximo =
            context.accounts.concesionario.kilometraje_maximo;

        context.accounts.garantia.set_inner(Garantia {
            moto: context.accounts.moto.key(),
            concesionario: context.accounts.concesionario.key(),
            fecha_inicio,
            fecha_vencimiento,
            kilometraje_maximo,
            estado: EstadoGarantia::Activa,
        });

        context.accounts.concesionario.total_motos = context
            .accounts
            .concesionario
            .total_motos
            .checked_add(1)
            .ok_or(Errores::ContadorInvalido)?;

        msg!("========================================");
        msg!("       MOTO REGISTRADA");
        msg!("========================================");
        msg!("Serial N.I.V.: {}", serial);
        msg!("Placa: {}", placa);
        msg!("Marca: {}", marca);
        msg!("Modelo: {}", modelo);
        msg!("Color: {}", color);
        msg!("Concesionario: {}", context.accounts.concesionario.key());
        msg!("Moto PDA: {}", context.accounts.moto.key());
        msg!("Garantia PDA: {}", context.accounts.garantia.key());
        msg!("Servicios: {}", 0);
        msg!("Estado: Registrada exitosamente");
        msg!("========================================");
        
        Ok(())
    }

    pub fn registrar_cliente(
        context: Context<RegistrarCliente>,
        nombre_concesionario: String,
        cedula_cliente: u32,
        nombre_cliente: String,
    ) -> Result<()> {

        require!(
            nombre_cliente.len() <= 50,
            Errores::NombreClienteInvalido
        );

        require!(
            cedula_cliente > 0,
            Errores::CedulaInvalida
        );
        
        let owner = context.accounts.owner.key();
        let cliente = &mut context.accounts.cliente;

        if cliente.owner == Pubkey::default() {
            let id_global = context.accounts.concesionario.total_clientes
                .checked_add(1)
                .ok_or(Errores::ContadorInvalido)?;
            cliente.set_inner(Cliente {
                owner,
                id_cliente: id_global,
                nombre_cliente: nombre_cliente.clone(),
                cedula_cliente,
                total_motos_cliente: 0,
            });
        } else {
            require_keys_eq!(cliente.owner, owner, Errores::Unauthorized);
            require!(cliente.cedula_cliente == cedula_cliente, Errores::CedulaInvalida);
        }

        let association = &mut context.accounts.asociacion_cliente;
        if association.concesionario == Pubkey::default() {
            let total_clientes = context.accounts.concesionario.total_clientes
                .checked_add(1)
                .ok_or(Errores::ContadorInvalido)?;
            context.accounts.concesionario.total_clientes = total_clientes;
            association.set_inner(AsociacionCliente {
                owner,
                concesionario: context.accounts.concesionario.key(),
                cliente: context.accounts.cliente.key(),
                fecha_registro: Clock::get()?.unix_timestamp,
                activo: true,
                bump: context.bumps.asociacion_cliente,
            });
        } else {
            require_keys_eq!(
                association.concesionario,
                context.accounts.concesionario.key(),
                Errores::AsociacionClienteInvalida
            );
            require_keys_eq!(
                association.cliente,
                context.accounts.cliente.key(),
                Errores::AsociacionClienteInvalida
            );
            require!(association.activo, Errores::AsociacionClienteInactiva);
            return err!(Errores::ClienteYaAsociado);
        }

        let id_cliente = context.accounts.cliente.id_cliente;

        msg!("========================================");
        msg!("       CLIENTE REGISTRADO");
        msg!("========================================");
        msg!("Nombre: {}", nombre_cliente);
        msg!("Cedula: {}", cedula_cliente);
        msg!("ID Cliente: {}", id_cliente);
        msg!("Concesionario: {}", nombre_concesionario);
        msg!("Owner: {}", context.accounts.owner.key());
        msg!("Cliente PDA: {}", context.accounts.cliente.key());
        msg!("Total clientes: {}", context.accounts.concesionario.total_clientes);
        msg!("Estado: Registrado exitosamente");
        msg!("========================================");

        Ok(())
    }

    /// Creates the dealership-specific relationship for a previously registered global customer.
    /// Used by the migration utility and by future customer onboarding flows.
    pub fn registrar_asociacion_cliente(
        context: Context<RegistrarAsociacionCliente>,
    ) -> Result<()> {
        require_keys_eq!(
            context.accounts.cliente.owner,
            context.accounts.owner.key(),
            Errores::Unauthorized
        );

        let association = &mut context.accounts.asociacion_cliente;
        if association.concesionario == Pubkey::default() {
            association.set_inner(AsociacionCliente {
                owner: context.accounts.owner.key(),
                concesionario: context.accounts.concesionario.key(),
                cliente: context.accounts.cliente.key(),
                fecha_registro: Clock::get()?.unix_timestamp,
                activo: true,
                bump: context.bumps.asociacion_cliente,
            });
        } else {
            require_keys_eq!(
                association.concesionario,
                context.accounts.concesionario.key(),
                Errores::AsociacionClienteInvalida
            );
            require_keys_eq!(
                association.cliente,
                context.accounts.cliente.key(),
                Errores::AsociacionClienteInvalida
            );
            require!(association.activo, Errores::AsociacionClienteInactiva);
        }

        Ok(())
    }

    pub fn registrar_venta(
        context: Context<RegistrarVenta>,
        nombre_concesionario: String,
        serial: String,
        cedula_cliente: u32,
        precio_venta: u64,
    ) -> Result<()> {

        require!(
            precio_venta > 0,
            Errores::PrecioVentaInvalido
        );

        let fecha_venta = Clock::get()?.unix_timestamp;

        context.accounts.concesionario.total_ventas = 
            context.accounts.concesionario.total_ventas
                .checked_add(1)
                .ok_or(Errores::ContadorInvalido)?;

        context.accounts.cliente.total_motos_cliente =
            context.accounts.cliente.total_motos_cliente
                .checked_add(1)
                .ok_or(Errores::ContadorInvalido)?; 

        context.accounts.moto.vendida = true;

        context.accounts.venta.set_inner(Venta {
            concesionario: context.accounts.concesionario.key(),
            cliente: context.accounts.cliente.key(),
            moto: context.accounts.moto.key(),
            fecha_venta,
            precio_venta,
        });

        msg!("========================================");
        msg!("          VENTA REGISTRADA");
        msg!("========================================");
        msg!("Concesionario: {}", nombre_concesionario);
        msg!("Cliente PDA: {}", context.accounts.cliente.key());
        msg!("Cedula: {}", cedula_cliente);
        msg!("Moto PDA: {}", context.accounts.moto.key());
        msg!("Serial N.I.V.: {}", serial);
        msg!("Venta PDA: {}", context.accounts.venta.key());
        msg!("Precio: {}", precio_venta);
        msg!("Fecha: {}", fecha_venta);
        msg!("Total ventas: {}", context.accounts.concesionario.total_ventas);
        msg!("Motocicletas del cliente: {}", context.accounts.cliente.total_motos_cliente);
        msg!("Estado: Venta registrada exitosamente");
        msg!("========================================");

        Ok(())
    }

    pub fn registrar_servicio(
        context: Context<RegistrarServicio>,
        nombre_concesionario: String,
        serial: String,
        kilometraje: u64,
        descripcion: String,
        costo: u64,
        tipo: TipoServicio,
    ) -> Result<()> {

        require!(
            descripcion.len() <= 100,
            Errores::DescripcionServicioInvalida
        );

        let fecha_servicio = Clock::get()?.unix_timestamp;

        actualizar_kilometraje_moto(
            &mut context.accounts.kilometraje_moto,
            context.accounts.moto.key(),
            context.accounts.concesionario.key(),
            kilometraje,
            fecha_servicio,
            context.bumps.kilometraje_moto,
        )?;

        if tipo == TipoServicio::Garantia {

            require!(
                context.accounts.garantia.estado == EstadoGarantia::Activa,
                Errores::GarantiaNoActiva
            );

            require!(
                fecha_servicio <= context.accounts.garantia.fecha_vencimiento,
                Errores::GarantiaVencida
            );

            require!(
                kilometraje <= context.accounts.garantia.kilometraje_maximo,
                Errores::KilometrajeGarantiaExcedido
            );
        }

        context.accounts.moto.servicios =
            context.accounts.moto.servicios
                .checked_add(1)
                .ok_or(Errores::ContadorInvalido)?;

        context.accounts.concesionario.total_servicios =
            context.accounts.concesionario.total_servicios
                .checked_add(1)
                .ok_or(Errores::ContadorInvalido)?;

        context.accounts.servicio.set_inner(Servicio {
            concesionario: context.accounts.concesionario.key(),
            moto: context.accounts.moto.key(),
            fecha_servicio,
            kilometraje,
            descripcion: descripcion.clone(),
            costo,
            tipo,
        });

        msg!("========================================");
        msg!("       SERVICIO REGISTRADO");
        msg!("========================================");
        msg!("Concesionario: {}", nombre_concesionario);
        msg!("Moto PDA: {}", context.accounts.moto.key());
        msg!("Serial N.I.V.: {}", serial);
        msg!("Servicio PDA: {}", context.accounts.servicio.key());
        msg!("Fecha: {}", fecha_servicio);
        msg!("Kilometraje: {} km", kilometraje);
        msg!("Descripcion: {}", descripcion);
        msg!("Costo: {}", costo);
        msg!("Total servicios moto: {}", context.accounts.moto.servicios);
        msg!("Total servicios concesionario: {}", context.accounts.concesionario.total_servicios);
        msg!("Estado: Servicio registrado exitosamente");
        msg!("========================================");

        Ok(())
    }

    pub fn reclamar_garantia(
        context: Context<ReclamarGarantia>,
        nombre_concesionario: String,
        serial: String,
        kilometraje: u64,
        descripcion: String,
    ) -> Result<()> {

        require!(
            descripcion.len() <= 100,
            Errores::DescripcionReclamacionInvalida
        );

        let fecha_reclamacion = Clock::get()?.unix_timestamp;

        actualizar_kilometraje_moto(
            &mut context.accounts.kilometraje_moto,
            context.accounts.moto.key(),
            context.accounts.concesionario.key(),
            kilometraje,
            fecha_reclamacion,
            context.bumps.kilometraje_moto,
        )?;

        require!(
            context.accounts.garantia.estado == EstadoGarantia::Activa,
            Errores::GarantiaNoActiva
        );

        require!(
            fecha_reclamacion >= context.accounts.garantia.fecha_inicio,
            Errores::GarantiaNoIniciada
        );

        require!(
            fecha_reclamacion <= context.accounts.garantia.fecha_vencimiento,
            Errores::GarantiaVencida
        );

        require!(
            kilometraje <= context.accounts.garantia.kilometraje_maximo,
            Errores::KilometrajeGarantiaExcedido
        );

        context.accounts.moto.total_reclamaciones =
            context.accounts.moto.total_reclamaciones
                .checked_add(1)
                .ok_or(Errores::ContadorInvalido)?;

        context.accounts.reclamacion.set_inner(Reclamacion {
            concesionario: context.accounts.concesionario.key(),
            moto: context.accounts.moto.key(),
            garantia: context.accounts.garantia.key(),
            fecha_reclamacion,
            kilometraje,
            descripcion: descripcion.clone(),
            estado: EstadoReclamacion::Pendiente,
        });

        msg!("========================================");
        msg!("       RECLAMACION DE GARANTIA");
        msg!("========================================");
        msg!("Concesionario: {}", nombre_concesionario);
        msg!("Serial N.I.V.: {}", serial);
        msg!("Moto PDA: {}", context.accounts.moto.key());
        msg!("Garantia PDA: {}", context.accounts.garantia.key());
        msg!("Reclamacion PDA: {}", context.accounts.reclamacion.key());
        msg!("Fecha: {}", fecha_reclamacion);
        msg!("Kilometraje: {} km", kilometraje);
        msg!("Descripcion: {}", descripcion);
        msg!("Estado: Pendiente");
        msg!("Total reclamaciones: {}", context.accounts.moto.total_reclamaciones);
        msg!("========================================");

        Ok(())
    }

    pub fn eliminar_moto(
        context: Context<EliminarMoto>,
        nombre_concesionario: String,
        serial: String,
    ) -> Result<()> {

        require!(
            !context.accounts.moto.vendida,
            Errores::MotoVendida
        );

        require!(
            context.accounts.moto.servicios == 0
                && context.accounts.moto.total_reclamaciones == 0,
            Errores::MotoConHistorial
        );

        context.accounts.concesionario.total_motos =
            context.accounts.concesionario.total_motos
                .checked_sub(1)
                .ok_or(Errores::ContadorInvalido)?;

        // Close the mileage PDA only when it already exists. Legacy motorcycles
        // may not have this account, so deletion must not initialize it.
        let kilometraje_info = context.accounts.kilometraje_moto.to_account_info();
        if *kilometraje_info.owner == crate::ID {
            let lamports = kilometraje_info.lamports();
            let owner_info = context.accounts.owner.to_account_info();
            let owner_lamports = owner_info.lamports();
            let updated_owner_lamports = owner_lamports
                .checked_add(lamports)
                .ok_or(Errores::ContadorInvalido)?;

            **kilometraje_info.try_borrow_mut_lamports()? = 0;
            **owner_info.try_borrow_mut_lamports()? = updated_owner_lamports;
            kilometraje_info.realloc(0, false)?;
            kilometraje_info.assign(&system_program::ID);
        } else {
            require!(
                *kilometraje_info.owner == system_program::ID
                    && kilometraje_info.data_is_empty(),
                Errores::KilometrajeMotoInvalido
            );
        }

        msg!("========================================");
        msg!("          ELIMINAR MOTOCICLETA");
        msg!("========================================");
        msg!("Concesionario: {}", nombre_concesionario);
        msg!("Serial N.I.V.: {}", serial);
        msg!("Moto PDA: {}", context.accounts.moto.key());
        msg!("Garantia PDA: {}", context.accounts.garantia.key());
        msg!("Fecha: {}", Clock::get()?.unix_timestamp);
        msg!("Estado: Eliminada");
        msg!("Total motocicletas: {}", context.accounts.concesionario.total_motos);
        msg!("========================================");

        Ok(())
    }


    pub fn configurar_programa_fidelidad(context: Context<ConfigurarProgramaFidelidad>, nombre_concesionario: String, puntos_por_venta: u64) -> Result<()> {
        require!(puntos_por_venta > 0, Errores::PuntosInvalidos);
        require_keys_eq!(context.accounts.token_program.key(), anchor_spl::token_2022::ID, Errores::Token2022Requerido);
        require!(context.accounts.mint.decimals == 0, Errores::DecimalesMintInvalidos);
        
        let mint_account_info = context.accounts.mint.to_account_info();
        let mint_data = mint_account_info.try_borrow_data()?;
        let mint_state = StateWithExtensions::<anchor_spl::token_2022::spl_token_2022::state::Mint>::unpack(&mint_data,)?;
        let mint_extensions = mint_state.get_extension_types()?;

        require!(mint_extensions.contains(&ExtensionType::NonTransferable), Errores::MintNoTransferible);
        drop(mint_data);
        require_keys_eq!(context.accounts.mint.mint_authority.unwrap_or_default(), context.accounts.autoridad_fidelidad.key(), Errores::AutoridadMintInvalida);
        
        context.accounts.programa_fidelidad.set_inner(ProgramaFidelidad {
            concesionario: context.accounts.concesionario.key(),
            mint: context.accounts.mint.key(),
            puntos_por_venta,
            bump: context.bumps.programa_fidelidad,
        });

        msg!("Programa de fidelizacion configurado para {}", nombre_concesionario);
        
        Ok(())
    }

    /// Registers the IPFS CIDs for an existing loyalty program.
    /// This uses a separate PDA to preserve the layout of ProgramaFidelidad accounts
    /// that may already exist on Devnet or Mainnet.
    pub fn registrar_metadata_fidelidad(
        context: Context<RegistrarMetadataFidelidad>,
        metadata_cid: String,
        image_cid: String,
    ) -> Result<()> {
        validar_cid(&metadata_cid)?;
        validar_cid(&image_cid)?;

        require_keys_eq!(
            *context.accounts.mint.to_account_info().owner,
            anchor_spl::token_2022::ID,
            Errores::Token2022Requerido
        );
        require_keys_eq!(
            context.accounts.mint.mint_authority.unwrap_or_default(),
            context.accounts.autoridad_fidelidad.key(),
            Errores::AutoridadMintInvalida
        );

        context.accounts.metadata_fidelidad.set_inner(MetadataFidelidad {
            programa_fidelidad: context.accounts.programa_fidelidad.key(),
            metadata_cid,
            image_cid,
            bump: context.bumps.metadata_fidelidad,
        });

        Ok(())
    }

    /// Updates the IPFS CIDs without changing the loyalty program or mint.
    pub fn actualizar_metadata_fidelidad(
        context: Context<ActualizarMetadataFidelidad>,
        metadata_cid: String,
        image_cid: String,
    ) -> Result<()> {
        validar_cid(&metadata_cid)?;
        validar_cid(&image_cid)?;

        require_keys_eq!(
            *context.accounts.mint.to_account_info().owner,
            anchor_spl::token_2022::ID,
            Errores::Token2022Requerido
        );
        require_keys_eq!(
            context.accounts.mint.mint_authority.unwrap_or_default(),
            context.accounts.autoridad_fidelidad.key(),
            Errores::AutoridadMintInvalida
        );

        context.accounts.metadata_fidelidad.metadata_cid = metadata_cid;
        context.accounts.metadata_fidelidad.image_cid = image_cid;

        Ok(())
    }

    pub fn actualizar_puntos_fidelidad(context: Context<ActualizarPuntosFidelidad>, puntos_por_venta: u64) -> Result<()> {
        require!(puntos_por_venta > 0, Errores::PuntosInvalidos);
        context.accounts.programa_fidelidad.puntos_por_venta = puntos_por_venta;
        Ok(())
    }

    pub fn vincular_wallet_cliente(context: Context<VincularWalletCliente>) -> Result<()> {
        require!(
            context.accounts.cliente.total_motos_cliente > 0,
            Errores::ClienteSinCompras
        );

        context.accounts.wallet_cliente.set_inner(WalletCliente {
            cliente: context.accounts.cliente.key(),
            wallet: context.accounts.wallet.key(),
            bump: context.bumps.wallet_cliente,
        });
        Ok(())
    }

    /// Removes the wallet association for a customer without deleting customer history.
    pub fn desvincular_wallet_cliente(
        _context: Context<DesvincularWalletCliente>,
    ) -> Result<()> {
        Ok(())
    }

    pub fn otorgar_puntos(context: Context<OtorgarPuntos>) -> Result<()> {
        let cantidad = context.accounts.programa_fidelidad.puntos_por_venta;
        require!(cantidad > 0, Errores::PuntosInvalidos);
        require_keys_eq!(context.accounts.venta.concesionario, context.accounts.concesionario.key(), Errores::VentaNoCorresponde);
        require_keys_eq!(context.accounts.venta.cliente, context.accounts.cliente.key(), Errores::VentaNoCorresponde);
        require_keys_eq!(context.accounts.wallet_cliente.wallet, context.accounts.token_account.owner, Errores::WalletClienteInvalida);
        require_keys_eq!(context.accounts.mint.key(), context.accounts.programa_fidelidad.mint, Errores::MintInvalido);
        require_keys_eq!(context.accounts.token_program.key(), anchor_spl::token_2022::ID, Errores::Token2022Requerido);
        require!(context.accounts.mint.decimals == 0, Errores::DecimalesMintInvalidos);
        require_keys_eq!(context.accounts.mint.mint_authority.unwrap_or_default(), context.accounts.autoridad_fidelidad.key(), Errores::AutoridadMintInvalida);

        let concession = context.accounts.concesionario.key();
        let bump = [context.bumps.autoridad_fidelidad];
        let seeds: &[&[u8]] = &[b"autoridad_fidelidad", concession.as_ref(), &bump];
        token_interface::mint_to(
            CpiContext::new_with_signer(
                context.accounts.token_program.to_account_info(),
                MintTo {
                    mint: context.accounts.mint.to_account_info(),
                    to: context.accounts.token_account.to_account_info(),
                    authority: context.accounts.autoridad_fidelidad.to_account_info(),
                },
                &[seeds],
            ),
            cantidad,
        )?;

        context.accounts.puntos_venta.set_inner(PuntosVenta {
            venta: context.accounts.venta.key(),
            cliente: context.accounts.cliente.key(),
            wallet: context.accounts.wallet_cliente.wallet,
            cantidad,
            fecha_emision: Clock::get()?.unix_timestamp,
            bump: context.bumps.puntos_venta,
        });
        Ok(())
    }


    /// Creates the initial redemption catalog for a dealership.
    /// The catalog is a separate PDA so existing account layouts remain unchanged.
    pub fn inicializar_catalogo_servicios(
        context: Context<InicializarCatalogoServicios>,
    ) -> Result<()> {
        context.accounts.catalogo_servicios.set_inner(CatalogoServicios {
            concesionario: context.accounts.concesionario.key(),
            total_servicios: 4,
            servicios: vec![
                ServicioCatalogo {
                    id: 1,
                    nombre: "Cambio de aceite".to_string(),
                    descripcion: "Cambio de aceite y revision basica".to_string(),
                    puntos: 80,
                    activo: true,
                },
                ServicioCatalogo {
                    id: 2,
                    nombre: "Ajuste de frenos".to_string(),
                    descripcion: "Revision y ajuste basico de frenos".to_string(),
                    puntos: 60,
                    activo: true,
                },
                ServicioCatalogo {
                    id: 3,
                    nombre: "Revision general".to_string(),
                    descripcion: "Inspeccion general de la motocicleta".to_string(),
                    puntos: 120,
                    activo: true,
                },
                ServicioCatalogo {
                    id: 4,
                    nombre: "Mantenimiento preventivo".to_string(),
                    descripcion: "Mantenimiento preventivo general".to_string(),
                    puntos: 150,
                    activo: true,
                },
            ],
            bump: context.bumps.catalogo_servicios,
        });

        msg!("Catalogo inicial de servicios creado para el concesionario");
        Ok(())
    }

    /// Updates the price, description, name or availability of an existing service.
    pub fn actualizar_servicio_catalogo(
        context: Context<AdministrarCatalogoServicios>,
        servicio_id: u8,
        nombre: String,
        descripcion: String,
        puntos: u64,
        activo: bool,
    ) -> Result<()> {
        require!(!nombre.is_empty() && nombre.len() <= 40, Errores::NombreServicioInvalido);
        require!(descripcion.len() <= 100, Errores::DescripcionServicioInvalida);
        require!(puntos > 0, Errores::PuntosInvalidos);

        let servicio = context.accounts.catalogo_servicios.servicios
            .iter_mut()
            .find(|servicio| servicio.id == servicio_id)
            .ok_or(Errores::ServicioNoEncontrado)?;

        servicio.nombre = nombre;
        servicio.descripcion = descripcion;
        servicio.puntos = puntos;
        servicio.activo = activo;

        Ok(())
    }

    /// Adds another service to the dealership catalog.
    pub fn agregar_servicio_catalogo(
        context: Context<AdministrarCatalogoServicios>,
        nombre: String,
        descripcion: String,
        puntos: u64,
        activo: bool,
    ) -> Result<()> {
        require!(!nombre.is_empty() && nombre.len() <= 40, Errores::NombreServicioInvalido);
        require!(descripcion.len() <= 100, Errores::DescripcionServicioInvalida);
        require!(puntos > 0, Errores::PuntosInvalidos);
        require!(
            context.accounts.catalogo_servicios.servicios.len() < CatalogoServicios::MAX_SERVICIOS,
            Errores::CatalogoLleno
        );

        let id = context.accounts.catalogo_servicios.total_servicios
            .checked_add(1)
            .ok_or(Errores::ContadorInvalido)?;

        context.accounts.catalogo_servicios.servicios.push(ServicioCatalogo {
            id,
            nombre,
            descripcion,
            puntos,
            activo,
        });
        context.accounts.catalogo_servicios.total_servicios = id;

        Ok(())
    }

    /// Burns the customer's non-transferable BERA points and stores an on-chain receipt.
    /// Both the dealership owner and the linked customer wallet must sign.
    pub fn canjear_servicio(
        context: Context<CanjearServicio>,
        servicio_id: u8,
        kilometraje_actual: u64,
        id_canje: u64,
    ) -> Result<()> {
        require!(id_canje > 0, Errores::IdCanjeInvalido);
        require!(
            context.accounts.cliente.total_motos_cliente > 0,
            Errores::ClienteSinCompras
        );
        require_keys_eq!(
            context.accounts.wallet_cliente.wallet,
            context.accounts.wallet.key(),
            Errores::WalletClienteInvalida
        );
        require!(
            context.accounts.moto.vendida,
            Errores::MotoNoVendida
        );
        require_keys_eq!(
            context.accounts.venta.concesionario,
            context.accounts.concesionario.key(),
            Errores::VentaNoCorresponde
        );
        require_keys_eq!(
            context.accounts.venta.cliente,
            context.accounts.cliente.key(),
            Errores::VentaNoCorresponde
        );
        require_keys_eq!(
            context.accounts.venta.moto,
            context.accounts.moto.key(),
            Errores::VentaNoCorresponde
        );
        require_keys_eq!(
            context.accounts.moto.concesionario,
            context.accounts.concesionario.key(),
            Errores::VentaNoCorresponde
        );
        require_keys_eq!(
            context.accounts.moto.garantia,
            context.accounts.garantia.key(),
            Errores::GarantiaNoCorresponde
        );
        require_keys_eq!(
            context.accounts.garantia.moto,
            context.accounts.moto.key(),
            Errores::GarantiaNoCorresponde
        );
        require_keys_eq!(
            context.accounts.garantia.concesionario,
            context.accounts.concesionario.key(),
            Errores::GarantiaNoCorresponde
        );

        let fecha_canje = Clock::get()?.unix_timestamp;

        actualizar_kilometraje_moto(
            &mut context.accounts.kilometraje_moto,
            context.accounts.moto.key(),
            context.accounts.concesionario.key(),
            kilometraje_actual,
            fecha_canje,
            context.bumps.kilometraje_moto,
        )?;

        require!(
            fecha_canje >= context.accounts.garantia.fecha_inicio,
            Errores::GarantiaNoIniciada
        );
        let garantia_cubre_servicio =
            context.accounts.garantia.estado == EstadoGarantia::Activa
            && fecha_canje <= context.accounts.garantia.fecha_vencimiento
            && kilometraje_actual <= context.accounts.garantia.kilometraje_maximo;
        require!(
            !garantia_cubre_servicio,
            Errores::CanjeDuranteGarantia
        );

        let servicio = context.accounts.catalogo_servicios.servicios
            .iter()
            .find(|servicio| servicio.id == servicio_id)
            .ok_or(Errores::ServicioNoEncontrado)?;

        require!(servicio.activo, Errores::ServicioNoDisponible);
        let puntos = servicio.puntos;
        let nombre_servicio = servicio.nombre.clone();

        require_keys_eq!(
            context.accounts.mint.key(),
            context.accounts.programa_fidelidad.mint,
            Errores::MintInvalido
        );
        require_keys_eq!(
            *context.accounts.mint.to_account_info().owner,
            anchor_spl::token_2022::ID,
            Errores::Token2022Requerido
        );
        require!(context.accounts.mint.decimals == 0, Errores::DecimalesMintInvalidos);
        require_keys_eq!(
            context.accounts.token_account.mint,
            context.accounts.mint.key(),
            Errores::MintInvalido
        );
        require_keys_eq!(
            context.accounts.token_account.owner,
            context.accounts.wallet.key(),
            Errores::WalletClienteInvalida
        );
        require!(
            context.accounts.token_account.amount >= puntos,
            Errores::SaldoInsuficiente
        );

        token_interface::burn(
            CpiContext::new(
                context.accounts.token_program.to_account_info(),
                Burn {
                    mint: context.accounts.mint.to_account_info(),
                    from: context.accounts.token_account.to_account_info(),
                    authority: context.accounts.wallet.to_account_info(),
                },
            ),
            puntos,
        )?;

        context.accounts.canje_servicio.set_inner(CanjeServicio {
            concesionario: context.accounts.concesionario.key(),
            catalogo_servicios: context.accounts.catalogo_servicios.key(),
            cliente: context.accounts.cliente.key(),
            wallet: context.accounts.wallet.key(),
            mint: context.accounts.mint.key(),
            venta: context.accounts.venta.key(),
            moto: context.accounts.moto.key(),
            kilometraje_actual,
            servicio_id,
            servicio_nombre: nombre_servicio.clone(),
            puntos,
            fecha_canje,
            id_canje,
            bump: context.bumps.canje_servicio,
        });

        msg!(
            "Canje confirmado: {} por {} BERA. Cliente: {}",
            nombre_servicio,
            puntos,
            context.accounts.cliente.key()
        );
        Ok(())
    }

}


#[account]
pub struct ProgramaFidelidad { 
    pub concesionario: Pubkey, 
    pub mint: Pubkey, 
    pub puntos_por_venta: u64, 
    pub bump: u8 
}

impl ProgramaFidelidad { 
    pub const LEN: usize = 
    DISCRIMINATOR + 
    32 + 
    32 + 
    8 + 
    1; 
}

/// IPFS references associated with a dealership's loyalty program.
#[account]
pub struct MetadataFidelidad {
    pub programa_fidelidad: Pubkey,
    pub metadata_cid: String,
    pub image_cid: String,
    pub bump: u8,
}

impl MetadataFidelidad {
    pub const MAX_CID_LENGTH: usize = 100;
    pub const LEN: usize =
        DISCRIMINATOR +
        32 +
        (4 + Self::MAX_CID_LENGTH) +
        (4 + Self::MAX_CID_LENGTH) +
        1;
}

fn validar_cid(cid: &str) -> Result<()> {
    require!(
        !cid.is_empty()
            && cid.len() <= MetadataFidelidad::MAX_CID_LENGTH
            && cid.bytes().all(|character| character.is_ascii_alphanumeric()),
        Errores::MetadataCidInvalido
    );
    Ok(())
}

#[account]
pub struct WalletCliente { 
    pub cliente: Pubkey, 
    pub wallet: Pubkey, 
    pub bump: u8 
}

impl WalletCliente { 
    pub const LEN: usize = 
    DISCRIMINATOR + 
    32 + 
    32 + 
    1; 
}

#[account]
pub struct PuntosVenta {
     pub venta: Pubkey, 
     pub cliente: Pubkey, 
     pub wallet: Pubkey, 
     pub cantidad: u64, 
     pub fecha_emision: i64, 
     pub bump: u8 
}

impl PuntosVenta { 
    pub const LEN: usize = 
    DISCRIMINATOR + 
    32 + 
    32 + 
    32 + 
    8 + 
    8 + 
    1; 
}

#[derive(Accounts)]
#[instruction(nombre_concesionario: String)]
pub struct ConfigurarProgramaFidelidad<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        constraint = concesionario.owner == owner.key() @ Errores::Unauthorized,
        seeds = [b"concesionario", nombre_concesionario.as_bytes(), owner.key().as_ref()], 
        bump, 
    )]
    pub concesionario: Account<'info, Concesionario>,

    #[account(
        init, 
        payer = owner, 
        space = ProgramaFidelidad::LEN, 
        seeds = [b"programa_fidelidad", concesionario.key().as_ref()], 
        bump
    )]
    pub programa_fidelidad: Account<'info, ProgramaFidelidad>,
    
    /// CHECK: PDA que actua como autoridad del mint.
    #[account(
        seeds = [b"autoridad_fidelidad", concesionario.key().as_ref()], 
        bump
    )]
    pub autoridad_fidelidad: UncheckedAccount<'info>,

    pub mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegistrarMetadataFidelidad<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        constraint = concesionario.owner == owner.key() @ Errores::Unauthorized,
        seeds = [b"concesionario", concesionario.nombre_concesionario.as_bytes(), owner.key().as_ref()],
        bump
    )]
    pub concesionario: Account<'info, Concesionario>,

    #[account(
        has_one = concesionario,
        seeds = [b"programa_fidelidad", concesionario.key().as_ref()],
        bump
    )]
    pub programa_fidelidad: Account<'info, ProgramaFidelidad>,

    #[account(
        init,
        payer = owner,
        space = MetadataFidelidad::LEN,
        seeds = [b"metadata_fidelidad", programa_fidelidad.key().as_ref()],
        bump
    )]
    pub metadata_fidelidad: Account<'info, MetadataFidelidad>,

    /// CHECK: PDA validated as the mint authority for this dealership.
    #[account(
        seeds = [b"autoridad_fidelidad", concesionario.key().as_ref()],
        bump
    )]
    pub autoridad_fidelidad: UncheckedAccount<'info>,

    #[account(address = programa_fidelidad.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ActualizarMetadataFidelidad<'info> {
    pub owner: Signer<'info>,

    #[account(
        constraint = concesionario.owner == owner.key() @ Errores::Unauthorized,
        seeds = [b"concesionario", concesionario.nombre_concesionario.as_bytes(), owner.key().as_ref()],
        bump
    )]
    pub concesionario: Account<'info, Concesionario>,

    #[account(
        has_one = concesionario,
        seeds = [b"programa_fidelidad", concesionario.key().as_ref()],
        bump
    )]
    pub programa_fidelidad: Account<'info, ProgramaFidelidad>,

    #[account(
        mut,
        has_one = programa_fidelidad,
        seeds = [b"metadata_fidelidad", programa_fidelidad.key().as_ref()],
        bump = metadata_fidelidad.bump
    )]
    pub metadata_fidelidad: Account<'info, MetadataFidelidad>,

    /// CHECK: PDA validated as the mint authority for this dealership.
    #[account(
        seeds = [b"autoridad_fidelidad", concesionario.key().as_ref()],
        bump
    )]
    pub autoridad_fidelidad: UncheckedAccount<'info>,

    #[account(address = programa_fidelidad.mint)]
    pub mint: InterfaceAccount<'info, Mint>,
}

#[derive(Accounts)]
pub struct ActualizarPuntosFidelidad<'info> {
    pub owner: Signer<'info>,
    #[account(
        constraint = concesionario.owner == owner.key() @ Errores::Unauthorized,
        seeds = [b"concesionario", concesionario.nombre_concesionario.as_bytes(), owner.key().as_ref()], 
        bump, 
    )]
    pub concesionario: Account<'info, Concesionario>,
    
    #[account(
        mut,
        has_one = concesionario,
        seeds = [b"programa_fidelidad", concesionario.key().as_ref()], 
        bump, 
    )]
    pub programa_fidelidad: Account<'info, ProgramaFidelidad>,
}

#[derive(Accounts)]
pub struct VincularWalletCliente<'info> {
    pub owner: Signer<'info>,
    
    #[account(mut)]
    pub wallet: Signer<'info>,
    
    #[account(
        constraint = cliente.owner == owner.key() @ Errores::Unauthorized,
        seeds = [b"cliente", owner.key().as_ref(), cliente.cedula_cliente.to_le_bytes().as_ref()], 
        bump
    )]
    pub cliente: Account<'info, Cliente>,

    #[account(
        init, 
        payer = wallet, 
        space = WalletCliente::LEN, 
        seeds = [b"wallet_cliente", cliente.key().as_ref()], 
        bump
    )]
    pub wallet_cliente: Account<'info, WalletCliente>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DesvincularWalletCliente<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        constraint = cliente.owner == owner.key() @ Errores::Unauthorized,
        seeds = [
            b"cliente",
            owner.key().as_ref(),
            cliente.cedula_cliente.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub cliente: Account<'info, Cliente>,

    #[account(
        mut,
        close = owner,
        has_one = cliente,
        seeds = [b"wallet_cliente", cliente.key().as_ref()],
        bump
    )]
    pub wallet_cliente: Account<'info, WalletCliente>,
}

#[derive(Accounts)]
pub struct OtorgarPuntos<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    
    #[account(
        constraint = concesionario.owner == owner.key() @ Errores::Unauthorized,
        seeds = [b"concesionario", concesionario.nombre_concesionario.as_bytes(), owner.key().as_ref()], 
        bump
    )]
    pub concesionario: Account<'info, Concesionario>,
    
    #[account(
        has_one = concesionario,
        seeds = [b"programa_fidelidad", concesionario.key().as_ref()], 
        bump
    )]
    pub programa_fidelidad: Account<'info, ProgramaFidelidad>,
    
    pub venta: Account<'info, Venta>,
    
    pub cliente: Account<'info, Cliente>,
    
    #[account(
        has_one = cliente,
        seeds = [b"wallet_cliente", cliente.key().as_ref()], 
        bump
    )]
    pub wallet_cliente: Account<'info, WalletCliente>,
    
    #[account(
        init, 
        payer = owner, 
        space = PuntosVenta::LEN, 
        seeds = [b"puntos_venta", venta.key().as_ref()], 
        bump
    )]
    pub puntos_venta: Account<'info, PuntosVenta>,
    
    /// CHECK: PDA validada por sus seeds; firma el CPI de mint_to.
    #[account(
        seeds = [b"autoridad_fidelidad", concesionario.key().as_ref()], 
        bump
    )]
    pub autoridad_fidelidad: UncheckedAccount<'info>,
    
    #[account(
        mut, 
        address = programa_fidelidad.mint
    )]
    pub mint: InterfaceAccount<'info, Mint>,
    
    #[account(
        mut, 
        constraint = token_account.mint == mint.key(), 
        constraint = token_account.owner == wallet_cliente.wallet
    )]
    pub token_account: InterfaceAccount<'info, TokenAccount>,
    
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}


#[derive(Accounts)]
pub struct InicializarCatalogoServicios<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        constraint = concesionario.owner == owner.key() @ Errores::Unauthorized,
        seeds = [b"concesionario", concesionario.nombre_concesionario.as_bytes(), owner.key().as_ref()],
        bump
    )]
    pub concesionario: Account<'info, Concesionario>,

    #[account(
        init,
        payer = owner,
        space = CatalogoServicios::LEN,
        seeds = [b"catalogo_servicios", concesionario.key().as_ref()],
        bump
    )]
    pub catalogo_servicios: Account<'info, CatalogoServicios>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdministrarCatalogoServicios<'info> {
    pub owner: Signer<'info>,

    #[account(
        constraint = concesionario.owner == owner.key() @ Errores::Unauthorized,
        seeds = [b"concesionario", concesionario.nombre_concesionario.as_bytes(), owner.key().as_ref()],
        bump
    )]
    pub concesionario: Account<'info, Concesionario>,

    #[account(
        mut,
        has_one = concesionario,
        seeds = [b"catalogo_servicios", concesionario.key().as_ref()],
        bump = catalogo_servicios.bump
    )]
    pub catalogo_servicios: Account<'info, CatalogoServicios>,
}

#[derive(Accounts)]
#[instruction(servicio_id: u8, kilometraje_actual: u64, id_canje: u64)]
pub struct CanjearServicio<'info> {
    /// The dealership owner pays the transaction fee and receipt rent, and confirms delivery.
    #[account(mut)]
    pub owner: Signer<'info>,

    /// The customer signs to authorize burning their BERA balance.
    pub wallet: Signer<'info>,

    #[account(
        constraint = concesionario.owner == owner.key() @ Errores::Unauthorized,
        seeds = [b"concesionario", concesionario.nombre_concesionario.as_bytes(), owner.key().as_ref()],
        bump
    )]
    pub concesionario: Account<'info, Concesionario>,

    #[account(
        has_one = concesionario,
        seeds = [b"programa_fidelidad", concesionario.key().as_ref()],
        bump
    )]
    pub programa_fidelidad: Account<'info, ProgramaFidelidad>,

    #[account(
        has_one = concesionario,
        seeds = [b"catalogo_servicios", concesionario.key().as_ref()],
        bump = catalogo_servicios.bump
    )]
    pub catalogo_servicios: Account<'info, CatalogoServicios>,

    #[account(
        constraint = cliente.owner == owner.key() @ Errores::Unauthorized,
        seeds = [b"cliente", owner.key().as_ref(), cliente.cedula_cliente.to_le_bytes().as_ref()],
        bump
    )]
    pub cliente: Account<'info, Cliente>,

    #[account(
        has_one = cliente,
        seeds = [b"wallet_cliente", cliente.key().as_ref()],
        bump = wallet_cliente.bump
    )]
    pub wallet_cliente: Account<'info, WalletCliente>,

    #[account(
        constraint = venta.concesionario == concesionario.key() @ Errores::VentaNoCorresponde,
        constraint = venta.cliente == cliente.key() @ Errores::VentaNoCorresponde,
        constraint = venta.moto == moto.key() @ Errores::VentaNoCorresponde
    )]
    pub venta: Account<'info, Venta>,

    #[account(
        constraint = moto.concesionario == concesionario.key() @ Errores::VentaNoCorresponde,
        constraint = moto.garantia == garantia.key() @ Errores::GarantiaNoCorresponde
    )]
    pub moto: Account<'info, Moto>,

    #[account(
        init_if_needed,
        payer = owner,
        space = KilometrajeMoto::LEN,
        seeds = [b"kilometraje_moto", moto.key().as_ref()],
        bump
    )]
    pub kilometraje_moto: Account<'info, KilometrajeMoto>,

    #[account(
        constraint = garantia.moto == moto.key() @ Errores::GarantiaNoCorresponde,
        constraint = garantia.concesionario == concesionario.key() @ Errores::GarantiaNoCorresponde
    )]
    pub garantia: Account<'info, Garantia>,

    #[account(
        mut,
        address = programa_fidelidad.mint
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        constraint = token_account.mint == mint.key() @ Errores::MintInvalido,
        constraint = token_account.owner == wallet.key() @ Errores::WalletClienteInvalida
    )]
    pub token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = owner,
        space = CanjeServicio::LEN,
        seeds = [b"canje_servicio", cliente.key().as_ref(), id_canje.to_le_bytes().as_ref()],
        bump
    )]
    pub canje_servicio: Account<'info, CanjeServicio>,

    #[account(address = anchor_spl::token_2022::ID)]
    pub token_program: Interface<'info, TokenInterface>,

    pub system_program: Program<'info, System>,
}

#[error_code]
pub enum Errores {
    #[msg("Error, el serial N.I.V debe tener una longitud de 17 caracteres")]
    NivInvalido,
    #[msg("Error, la placa debe tener una longitud de 7 caracteres")]
    PlacaInvalida,
    #[msg("No tienes autorizacion para realizar esta operacion")]
    Unauthorized,
    #[msg("La duracion de la garantia debe ser mayor a cero")]
    DuracionGarantiaInvalida,
    #[msg("El kilometraje maximo debe ser mayor a cero")]
    KilometrajeGarantiaInvalido,
    #[msg("El nombre del cliente no puede superar los 50 caracteres")]
    NombreClienteInvalido,
    #[msg("La cedula del cliente debe ser mayor a cero")]
    CedulaInvalida,
    #[msg("El cliente ya esta asociado a este concesionario")]
    ClienteYaAsociado,
    #[msg("La asociacion entre cliente y concesionario no es valida")]
    AsociacionClienteInvalida,
    #[msg("La asociacion del cliente con este concesionario esta inactiva")]
    AsociacionClienteInactiva,
    #[msg("El precio de venta debe ser mayor a cero")]
    PrecioVentaInvalido,
    #[msg("La descripcion del servicio no puede superar los 100 caracteres")]
    DescripcionServicioInvalida,
    #[msg("La garantia no se encuentra activa")]
    GarantiaNoActiva,
    #[msg("La garantia aun no ha comenzado")]
    GarantiaNoIniciada,
    #[msg("La garantia ha vencido")]
    GarantiaVencida,
    #[msg("El kilometraje supera el limite de la garantia")]
    KilometrajeGarantiaExcedido,
    #[msg("La descripcion de la reclamacion no puede superar los 100 caracteres")]
    DescripcionReclamacionInvalida,
    #[msg("No se puede eliminar una moto que ya fue vendida")]
    MotoVendida,
    #[msg("No se puede eliminar una moto que tiene historial de servicios o reclamaciones")]
    MotoConHistorial,
    #[msg("La cantidad de puntos debe ser mayor a cero")]
    PuntosInvalidos,
    #[msg("El mint debe tener activa la extension NonTransferable de Token-2022")]
    MintNoTransferible,
    #[msg("Esta operacion requiere el programa Token-2022")]
    Token2022Requerido,
    #[msg("El mint de fidelizacion debe tener cero decimales")]
    DecimalesMintInvalidos,
    #[msg("La autoridad del mint no coincide con la PDA del programa")]
    AutoridadMintInvalida,
    #[msg("El mint no coincide con el configurado para este concesionario")]
    MintInvalido,
    #[msg("La venta no corresponde al concesionario o al cliente indicados")]
    VentaNoCorresponde,
    #[msg("La wallet no esta vinculada al cliente o no coincide con la cuenta de tokens")]
    WalletClienteInvalida,
    #[msg("El servicio no existe en el catalogo")]
    ServicioNoEncontrado,
    #[msg("El servicio no esta disponible para canje")]
    ServicioNoDisponible,
    #[msg("El catalogo alcanzo el maximo de servicios")]
    CatalogoLleno,
    #[msg("El nombre del servicio debe contener entre 1 y 40 caracteres")]
    NombreServicioInvalido,
    #[msg("El cliente no tiene suficientes puntos BERA para este servicio")]
    SaldoInsuficiente,
    #[msg("El identificador del canje debe ser mayor a cero")]
    IdCanjeInvalido,
    #[msg("Este servicio de fidelizacion solo puede canjearse cuando la garantia ya no cubre la motocicleta")]
    CanjeDuranteGarantia,
    #[msg("La garantia no corresponde a la motocicleta seleccionada")]
    GarantiaNoCorresponde,
    #[msg("La motocicleta debe estar registrada como vendida")]
    MotoNoVendida,
    #[msg("Error: El contador ha alcanzado su valor máximo.")]
    ContadorInvalido,
    #[msg("El cliente debe tener al menos una motocicleta comprada en este concesionario para vincular su wallet")]
    ClienteSinCompras,
    #[msg("El CID debe contener entre 1 y 100 caracteres alfanuméricos")]
    MetadataCidInvalido,
    #[msg("El registro de kilometraje no corresponde a esta moto o concesionario")]
    KilometrajeMotoInvalido,
    #[msg("El kilometraje no puede ser inferior al último valor registrado")]
    KilometrajeDecreciente,
}


/// A service offered in exchange for loyalty points.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct ServicioCatalogo {
    pub id: u8,
    #[max_len(40)]
    pub nombre: String,
    #[max_len(100)]
    pub descripcion: String,
    pub puntos: u64,
    pub activo: bool,
}

#[account]
#[derive(InitSpace)]
pub struct CatalogoServicios {
    pub concesionario: Pubkey,
    pub total_servicios: u8,
    #[max_len(8)]
    pub servicios: Vec<ServicioCatalogo>,
    pub bump: u8,
}

impl CatalogoServicios {
    pub const MAX_SERVICIOS: usize = 8;
    pub const LEN: usize = DISCRIMINATOR + Self::INIT_SPACE;
}

/// Immutable receipt created atomically with the Token-2022 burn.
#[account]
pub struct CanjeServicio {
    pub concesionario: Pubkey,
    pub catalogo_servicios: Pubkey,
    pub cliente: Pubkey,
    pub wallet: Pubkey,
    pub mint: Pubkey,
    pub venta: Pubkey,
    pub moto: Pubkey,
    pub kilometraje_actual: u64,
    pub servicio_id: u8,
    pub servicio_nombre: String,
    pub puntos: u64,
    pub fecha_canje: i64,
    pub id_canje: u64,
    pub bump: u8,
}

impl CanjeServicio {
    pub const MAX_NOMBRE: usize = 40;
    pub const LEN: usize =
        DISCRIMINATOR +
        32 + 32 + 32 + 32 + 32 + 32 + 32 +
        8 +
        1 + (4 + Self::MAX_NOMBRE) +
        8 + 8 + 8 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum EstadoGarantia {
    Activa,
    Vencida,
    Suspendida,
    Anulada,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum TipoServicio {
    Mantenimiento,
    Reparacion,
    Garantia,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum EstadoReclamacion {
    Pendiente,
    Aprobada,
    Rechazada,
}

pub const DISCRIMINATOR: usize = 8;

#[account]
pub struct RegistroGlobal {
    pub total_concesionarios: u16,
}

impl RegistroGlobal {
    pub const LEN: usize = 
    DISCRIMINATOR + 2;
}

#[account]
#[derive(InitSpace)]
pub struct Concesionario {
    pub owner: Pubkey,
    pub id_concesionario: u16,
    
    #[max_len(30)]
    pub nombre_concesionario: String,
   
    #[max_len(10)]
    pub rif_concesionario: String,
    
    pub total_servicios: u64,
    pub total_motos: u64,
    pub total_clientes: u32,
    pub total_ventas: u64,
    pub duracion_garantia_dias: u16,
    pub kilometraje_maximo: u64,
}

impl Concesionario {
    pub const LEN: usize =
        DISCRIMINATOR +
        32 +       // owner: Pubkey
        2  +       // id_concesionario: u16
        (4 + 30) + // nombre_concesionario: String
        (4 + 10) + // rif_concesionario: String
        8 +        // total_servicios: u64
        8 +        // total_motocicletas: u64
        4 +        // total_clientes: u32
        8 +        // total_ventas: u64,
        2 +        // duracion_garantia_dias: u16
        8;         // kilometraje_maximo: u64
}

#[account]
#[derive(InitSpace)]
pub struct Moto {
    #[max_len(17)]
    pub serial: String,

    #[max_len(7)]
    pub placa: String,

    #[max_len(20)]
    pub marca: String,

    #[max_len(30)]
    pub modelo: String,
   
    #[max_len(20)]
    pub color: String,

    pub garantia: Pubkey,
    pub concesionario: Pubkey,
    pub servicios: u64,
    pub total_reclamaciones: u64,
    pub vendida: bool
}

impl Moto {
    pub const LEN: usize =
        DISCRIMINATOR +
        (4 + 17) + // serial: String
        (4 + 7)  + // placa: String
        (4 + 20) + // marca: String
        (4 + 30) + // modelo: String
        (4 + 20) + // color: String
        32       + // garantia: Pubkey
        32       + // concesionario: Pubkey
        8        + // servicios: u64
        8;         // total_reclamaciones: u64
}

/// Latest known odometer reading shared by Services, Warranty and Loyalty.
#[account]
pub struct KilometrajeMoto {
    pub moto: Pubkey,
    pub concesionario: Pubkey,
    pub kilometraje_actual: u64,
    pub fecha_actualizacion: i64,
    pub bump: u8,
}

impl KilometrajeMoto {
    pub const LEN: usize = DISCRIMINATOR + 32 + 32 + 8 + 8 + 1;
}

fn actualizar_kilometraje_moto(
    registro: &mut Account<KilometrajeMoto>,
    moto: Pubkey,
    concesionario: Pubkey,
    kilometraje: u64,
    fecha: i64,
    bump: u8,
) -> Result<()> {
    if registro.moto == Pubkey::default() {
        registro.set_inner(KilometrajeMoto {
            moto,
            concesionario,
            kilometraje_actual: kilometraje,
            fecha_actualizacion: fecha,
            bump,
        });
        return Ok(());
    }

    require_keys_eq!(registro.moto, moto, Errores::KilometrajeMotoInvalido);
    require_keys_eq!(
        registro.concesionario,
        concesionario,
        Errores::KilometrajeMotoInvalido
    );
    require!(
        kilometraje >= registro.kilometraje_actual,
        Errores::KilometrajeDecreciente
    );

    if kilometraje > registro.kilometraje_actual {
        registro.kilometraje_actual = kilometraje;
        registro.fecha_actualizacion = fecha;
    }

    Ok(())
}

#[account]
pub struct Garantia {
    pub moto: Pubkey,
    pub concesionario: Pubkey,
    pub fecha_inicio: i64,
    pub fecha_vencimiento: i64,
    pub kilometraje_maximo: u64,
    pub estado: EstadoGarantia,
}

impl Garantia {
     pub const LEN: usize =
        DISCRIMINATOR +
        32       + // moto: Pubkey
        32       + // concesionario: Pubkey
        8        + // fecha_inicio: i64
        8        + // fecha_vencimiento: i64
        8        + // kilometraje_maximo: u64
        1;
}

#[account]
pub struct Cliente {
    pub owner: Pubkey,
    pub id_cliente: u32,
    pub nombre_cliente: String,
    pub cedula_cliente: u32,
    pub total_motos_cliente: u16,
}

impl Cliente {
   pub const LEN: usize =
        DISCRIMINATOR +
        32       + // owner
        4        + // id_cliente
        (4 + 50) + // nombre_cliente
        4        + // cedula_cliente
        2;         // total_motocicletas
}

#[account]
pub struct AsociacionCliente {
    pub owner: Pubkey,
    pub concesionario: Pubkey,
    pub cliente: Pubkey,
    pub fecha_registro: i64,
    pub activo: bool,
    pub bump: u8,
}

impl AsociacionCliente {
    pub const LEN: usize =
        DISCRIMINATOR + 32 + 32 + 32 + 8 + 1 + 1;
}

#[account]
pub struct Venta {
    pub concesionario: Pubkey,
    pub cliente: Pubkey,
    pub moto: Pubkey,
    pub fecha_venta: i64,
    pub precio_venta: u64,
}

impl Venta {
    pub const LEN: usize =
        DISCRIMINATOR +
        32 + // concesionario: Pubkey
        32 + // cliente: Pubkey
        32 + // moto: Pubkey
        8 +  // fecha_venta: i64
        8;   // precio_venta: u64
}

#[account]
pub struct Servicio {
    pub concesionario: Pubkey,
    pub moto: Pubkey,
    pub fecha_servicio: i64,
    pub kilometraje: u64,
    pub descripcion: String,
    pub costo: u64,
    pub tipo: TipoServicio,
}

impl Servicio {
    pub const LEN: usize =
        DISCRIMINATOR +
        32        + // concesionario: Pubkey
        32        + // moto: Pubkey
        8         + // fecha_servicio: i64
        8         + // kilometraje: u64
        (4 + 100) + // descripcion: String
        8         + // costo: u64
        1;          // tipo: TipoServicio
}

#[account]
pub struct Reclamacion {
    pub concesionario: Pubkey,
    pub moto: Pubkey,
    pub garantia: Pubkey,
    pub fecha_reclamacion: i64,
    pub kilometraje: u64,
    pub descripcion: String,
    pub estado: EstadoReclamacion,
}

impl Reclamacion {
    pub const LEN: usize =
        DISCRIMINATOR +
        32        + // concesionario: Pubkey
        32        + // moto: Pubkey
        32        + // garantia: Pubkey
        8         + // fecha_reclamacion: i64
        8         + // kilometraje: u64
        (4 + 100) + // descripcion
        1;          // estado: EstadoReclamacion
}

#[derive(Accounts)]
#[instruction(nombre_concesionario: String)]
pub struct RegistrarConcesionario<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init_if_needed,
        payer = owner,
        space = RegistroGlobal::LEN,
        seeds = [b"registro_global"],
        bump
    )]
    pub registro_global: Account<'info, RegistroGlobal>,

    #[account(
        init,
        payer = owner,
        space = Concesionario::LEN,
        seeds = [
            b"concesionario", 
            nombre_concesionario.as_bytes(), 
            owner.key().as_ref()
        ],
        bump
    )]
    pub concesionario: Account<'info, Concesionario>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(nombre_concesionario: String)]
pub struct ConfigurarGarantia<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [
            b"concesionario",
            nombre_concesionario.as_bytes(),
            owner.key().as_ref()
        ],
        bump,
        constraint = concesionario.owner == owner.key()
            @ Errores::Unauthorized
    )]
    pub concesionario: Account<'info, Concesionario>,
}

#[derive(Accounts)]
#[instruction(serial: String)]
pub struct RegistrarMoto<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

     #[account(
        mut,
        constraint = concesionario.owner == owner.key()
    )]
    pub concesionario: Account<'info, Concesionario>,

   #[account(
        init,
        payer = owner,
        space = Garantia::LEN,
        seeds = [
            b"garantia",
            serial.as_bytes()
        ],
        bump
    )]
    pub garantia: Account<'info, Garantia>,

    #[account(
        init,
        payer = owner,
        space = Moto::LEN,
        seeds = [b"registro_moto", serial.as_bytes(), concesionario.key().as_ref()],
        bump
    )]
    pub moto: Account<'info, Moto>,

    #[account(
        init,
        payer = owner,
        space = KilometrajeMoto::LEN,
        seeds = [b"kilometraje_moto", moto.key().as_ref()],
        bump
    )]
    pub kilometraje_moto: Account<'info, KilometrajeMoto>,

    pub system_program: Program<'info, System>
}

#[derive(Accounts)]
#[instruction(nombre_concesionario: String, cedula_cliente: u32)]
pub struct RegistrarCliente<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [
            b"concesionario",
            nombre_concesionario.as_bytes(),
            owner.key().as_ref()
        ],
        bump,
        constraint = concesionario.owner == owner.key()
            @ Errores::Unauthorized
    )]
    pub concesionario: Account<'info, Concesionario>,

    #[account(
        init_if_needed,
        payer = owner,
        space = Cliente::LEN,
        seeds = [
            b"cliente",
            owner.key().as_ref(),
            cedula_cliente.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub cliente: Account<'info, Cliente>,

    #[account(
        init_if_needed,
        payer = owner,
        space = AsociacionCliente::LEN,
        seeds = [b"asociacion_cliente", concesionario.key().as_ref(), cliente.key().as_ref()],
        bump
    )]
    pub asociacion_cliente: Account<'info, AsociacionCliente>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegistrarAsociacionCliente<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        constraint = concesionario.owner == owner.key() @ Errores::Unauthorized
    )]
    pub concesionario: Account<'info, Concesionario>,

    #[account(
        seeds = [b"cliente", owner.key().as_ref(), cliente.cedula_cliente.to_le_bytes().as_ref()],
        bump,
        constraint = cliente.owner == owner.key() @ Errores::Unauthorized
    )]
    pub cliente: Account<'info, Cliente>,

    #[account(
        init_if_needed,
        payer = owner,
        space = AsociacionCliente::LEN,
        seeds = [b"asociacion_cliente", concesionario.key().as_ref(), cliente.key().as_ref()],
        bump
    )]
    pub asociacion_cliente: Account<'info, AsociacionCliente>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(
    nombre_concesionario: String,
    serial: String,
    cedula_cliente: u32
)]
pub struct RegistrarVenta<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [
            b"concesionario",
            nombre_concesionario.as_bytes(),
            owner.key().as_ref()
        ],
        bump,
        constraint = concesionario.owner == owner.key()
            @ Errores::Unauthorized
    )]
    pub concesionario: Account<'info, Concesionario>,

    #[account(
        mut,
        seeds = [
            b"cliente",
            owner.key().as_ref(),
            cedula_cliente.to_le_bytes().as_ref()
        ],
        bump,
        constraint = cliente.owner == owner.key()
            @ Errores::Unauthorized
    )]
    pub cliente: Account<'info, Cliente>,

    #[account(
        seeds = [b"asociacion_cliente", concesionario.key().as_ref(), cliente.key().as_ref()],
        bump = asociacion_cliente.bump,
        constraint = asociacion_cliente.owner == owner.key() @ Errores::AsociacionClienteInvalida,
        constraint = asociacion_cliente.activo @ Errores::AsociacionClienteInactiva,
        constraint = asociacion_cliente.concesionario == concesionario.key() @ Errores::AsociacionClienteInvalida,
        constraint = asociacion_cliente.cliente == cliente.key() @ Errores::AsociacionClienteInvalida
    )]
    pub asociacion_cliente: Account<'info, AsociacionCliente>,

    #[account(
        mut,
        seeds = [
            b"registro_moto",
            serial.as_bytes(),
            concesionario.key().as_ref()
        ],
        bump,
        constraint = moto.concesionario == concesionario.key()
            @ Errores::Unauthorized
    )]
    pub moto: Account<'info, Moto>,

    #[account(
        init,
        payer = owner,
        space = Venta::LEN,
        seeds = [
            b"venta",
            moto.key().as_ref()
        ],
        bump
    )]
    pub venta: Account<'info, Venta>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(nombre_concesionario: String, serial: String)]
pub struct RegistrarServicio<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [
            b"concesionario",
            nombre_concesionario.as_bytes(),
            owner.key().as_ref()
        ],
        bump,
        constraint = concesionario.owner == owner.key()
            @ Errores::Unauthorized
    )]
    pub concesionario: Account<'info, Concesionario>,

    #[account(
        mut,
        seeds = [
            b"registro_moto",
            serial.as_bytes(),
            concesionario.key().as_ref()
        ],
        bump,
        constraint = moto.concesionario == concesionario.key()
            @ Errores::Unauthorized
    )]
    pub moto: Account<'info, Moto>,

    #[account(
        seeds = [
            b"garantia",
            serial.as_bytes()
        ],
        bump,
        constraint = garantia.moto == moto.key()
            @ Errores::Unauthorized
    )]
    pub garantia: Account<'info, Garantia>,

    #[account(
        init_if_needed,
        payer = owner,
        space = KilometrajeMoto::LEN,
        seeds = [b"kilometraje_moto", moto.key().as_ref()],
        bump
    )]
    pub kilometraje_moto: Account<'info, KilometrajeMoto>,

    #[account(
        init,
        payer = owner,
        space = Servicio::LEN,
        seeds = [
            b"servicio",
            moto.key().as_ref(),
            moto.servicios.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub servicio: Account<'info, Servicio>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(nombre_concesionario: String, serial: String)]
pub struct ReclamarGarantia<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [
            b"concesionario",
            nombre_concesionario.as_bytes(),
            owner.key().as_ref()
        ],
        bump,
        constraint = concesionario.owner == owner.key()
            @ Errores::Unauthorized
    )]
    pub concesionario: Account<'info, Concesionario>,

    #[account(
        mut,
        seeds = [
            b"registro_moto",
            serial.as_bytes(),
            concesionario.key().as_ref()
        ],
        bump,
        constraint = moto.concesionario == concesionario.key()
            @ Errores::Unauthorized
    )]
    pub moto: Account<'info, Moto>,

    #[account(
        seeds = [
            b"garantia",
            serial.as_bytes()
        ],
        bump,
        constraint = garantia.moto == moto.key()
            @ Errores::Unauthorized
    )]
    pub garantia: Account<'info, Garantia>,

    #[account(
        init_if_needed,
        payer = owner,
        space = KilometrajeMoto::LEN,
        seeds = [b"kilometraje_moto", moto.key().as_ref()],
        bump
    )]
    pub kilometraje_moto: Account<'info, KilometrajeMoto>,

    #[account(
        init,
        payer = owner,
        space = Reclamacion::LEN,
        seeds = [
            b"reclamacion",
            moto.key().as_ref(),
            moto.total_reclamaciones.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub reclamacion: Account<'info, Reclamacion>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(nombre_concesionario: String, serial: String)]
pub struct EliminarMoto<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [
            b"concesionario",
            nombre_concesionario.as_bytes(),
            owner.key().as_ref()
        ],
        bump,
        constraint = concesionario.owner == owner.key()
            @ Errores::Unauthorized
    )]
    pub concesionario: Account<'info, Concesionario>,

    #[account(
        mut,
        close = owner,
        seeds = [
            b"registro_moto",
            serial.as_bytes(),
            concesionario.key().as_ref()
        ],
        bump,
        constraint = moto.concesionario == concesionario.key()
            @ Errores::Unauthorized,
        constraint = !moto.vendida
            @ Errores::MotoVendida,
        constraint = moto.servicios == 0
            @ Errores::MotoConHistorial,
        constraint = moto.total_reclamaciones == 0
            @ Errores::MotoConHistorial
    )]
    pub moto: Account<'info, Moto>,

    /// CHECK: Optional PDA. Legacy motorcycles may not have a mileage account.
    /// The handler validates its owner and closes it manually when program-owned.
    #[account(
        mut,
        seeds = [b"kilometraje_moto", moto.key().as_ref()],
        bump
    )]
    pub kilometraje_moto: UncheckedAccount<'info>,

    #[account(
        mut,
        close = owner,
        seeds = [
            b"garantia",
            serial.as_bytes()
        ],
        bump,
        constraint = garantia.moto == moto.key()
            @ Errores::Unauthorized
    )]
    pub garantia: Account<'info, Garantia>,

    pub system_program: Program<'info, System>,
}